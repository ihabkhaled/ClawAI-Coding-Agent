import { z } from 'zod';

import { planQualityExecution } from '../core/quality-graph';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { QualityToolExecutor } from './quality-tool-executor';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { GitAgentService } from '../services/git-agent-service';
import type {
  IntegrationGitPort,
  IntegrationQualityPort,
  IntegrationCoordinatorService,
} from '../services/integration-coordinator-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const toolInputSchema = z.object({ request: z.unknown() }).strict();
const qualityResultSchema = z
  .object({ gateId: z.string(), status: z.enum(['passed', 'failed']) })
  .loose();

export const integrationToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.integration',
  version: '2.0.0',
  description:
    'Integrate isolated sub-agent commits deterministically and rerun mandatory quality gates.',
  operations: ['integrate'],
  riskClasses: ['git-mutate', 'process'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.integration,
};

export class IntegrationToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly coordinator: IntegrationCoordinatorService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (
      invocation.toolName !== integrationToolDefinition.name ||
      invocation.operation !== 'integrate'
    )
      throw new Error('Unknown integration operation');
    const input = toolInputSchema.parse(invocation.arguments);
    return { structured: { receipt: await this.coordinator.integrate(input.request, signal) } };
  }
}

export class RuntimeIntegrationGitAdapter implements IntegrationGitPort {
  constructor(
    private readonly git: GitAgentService,
    private readonly worktrees: { release(worktreeId: string): Promise<void> },
  ) {}

  async workingFingerprint(worktreeId: string): Promise<string> {
    const receipt = await this.git.execute({ rootKey: worktreeId, operation: 'status' });
    return `${receipt.afterHead ?? 'unborn'}:${receipt.afterWorkingTreeHash}`;
  }

  verifyCommit(
    worktreeId: string,
    commit: string,
    changedPaths: readonly string[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    return this.git.verifyCommit(worktreeId, commit, changedPaths, signal);
  }

  async cherryPick(
    worktreeId: string,
    commit: string,
    signal?: AbortSignal,
  ): Promise<{ readonly conflicts: readonly string[] }> {
    try {
      await this.git.execute(
        { rootKey: worktreeId, operation: 'cherry-pick', ref: commit },
        signal,
      );
      return { conflicts: [] };
    } catch (error) {
      const receipt = await this.git.execute(
        { rootKey: worktreeId, operation: 'conflicts' },
        signal,
      );
      const conflicts = receipt.output
        .split(/\r?\n/u)
        .map((path) => path.trim())
        .filter(Boolean);
      if (conflicts.length === 0) throw error;
      return { conflicts };
    }
  }

  abortCherryPick(worktreeId: string): Promise<void> {
    return this.git.abortCherryPick(worktreeId);
  }

  releaseWorktree(worktreeId: string): Promise<void> {
    return this.worktrees.release(worktreeId);
  }
}

export class RuntimeIntegrationQualityAdapter implements IntegrationQualityPort {
  constructor(private readonly quality: QualityToolExecutor) {}

  async run(
    worktreeId: string,
    gateIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly { readonly gateId: string; readonly passed: boolean }[]> {
    const projects = await this.quality.discoverProjects(worktreeId, signal);
    const gates = new Map(
      planQualityExecution(projects, 'delivery').gates.map((gate) => [gate.gateId, gate]),
    );
    const results: { gateId: string; passed: boolean }[] = [];
    for (const gateId of gateIds) {
      const gate = gates.get(gateId);
      if (gate === undefined)
        throw new Error(`Mandatory integration gate is unavailable: ${gateId}`);
      const output = await this.quality.runGate(gate, signal);
      const result = qualityResultSchema.parse(output.structured);
      results.push({ gateId: result.gateId, passed: result.status === 'passed' });
    }
    return results;
  }
}
