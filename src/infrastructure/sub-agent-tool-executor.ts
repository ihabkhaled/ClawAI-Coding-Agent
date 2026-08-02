import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';
import type { SubAgentCoordinatorService } from '../services/sub-agent-coordinator-service';

export const subAgentToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.agents',
  version: '2.0.0',
  description: 'Run a bounded dependency graph of scoped coding sub-agents.',
  operations: ['run'],
  riskClasses: ['process', 'workspace-write', 'git-mutate'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.agents,
};

export class SubAgentToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly coordinator: SubAgentCoordinatorService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== subAgentToolDefinition.name || invocation.operation !== 'run') {
      throw new Error('Unknown sub-agent operation');
    }
    const outcomes = await this.coordinator.run(invocation.arguments.graph, signal);
    return { structured: { outcomes } };
  }
}
