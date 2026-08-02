import path from 'node:path';

import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import { runCommandSpec } from './bounded-command-runner';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ElevationRecipe } from '../core/elevation-contract';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  ElevationBrokerService,
  ElevationVerificationPort,
} from '../services/elevation-broker-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const inputSchema = z.object({ recipe: z.unknown() }).strict();

export const elevationToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.elevation',
  version: '2.0.0',
  description:
    'Request one native-consent administrator operation from a typed bounded recipe; credentials never enter the model or extension.',
  operations: ['execute'],
  riskClasses: ['elevation'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.elevation,
};

export class ElevationToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly broker: ElevationBrokerService,
    private readonly files: VscodeFileTransactionAdapter,
    private readonly runId: () => string,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== elevationToolDefinition.name || invocation.operation !== 'execute')
      throw new Error('Unknown elevation operation');
    const input = inputSchema.parse(invocation.arguments);
    const rootKey = this.recipeRootKey(input.recipe);
    const receipt = await this.broker.execute(
      input.recipe,
      {
        runId: this.runId(),
        workspaceId: rootKey,
        workspaceRoot: this.files.workspaceRootUri(rootKey).fsPath,
        targetId: invocation.targetId,
        parentPid: process.pid,
      },
      signal,
    );
    return { structured: { receipt } };
  }

  private recipeRootKey(candidate: unknown): string {
    return z
      .looseObject({ command: z.looseObject({ cwdRootKey: z.string().min(1).max(100) }) })
      .parse(candidate).command.cwdRootKey;
  }
}

export class VscodeElevationVerificationAdapter implements ElevationVerificationPort {
  execute(recipe: ElevationRecipe, workspaceRoot: string, signal?: AbortSignal) {
    return runCommandSpec(
      recipe.verification,
      path.resolve(workspaceRoot, recipe.verification.cwd),
      signal,
    );
  }
}
