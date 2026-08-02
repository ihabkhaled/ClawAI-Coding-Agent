import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { ContainerEngineService } from '../services/container-engine-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const containerToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.container',
  version: '2.0.0',
  description: 'Inspect and control owned Docker, Podman, and Compose resources.',
  operations: [
    'engine-info',
    'contexts',
    'images',
    'containers',
    'networks',
    'volumes',
    'logs',
    'stats',
    'inspect',
    'health',
    'build',
    'pull',
    'run',
    'exec',
    'start',
    'stop',
    'restart',
    'remove',
    'compose-up',
    'compose-down',
    'compose-build',
    'compose-run',
    'compose-exec',
  ],
  riskClasses: ['inspect', 'container-mutate', 'network', 'destructive'],
  targetIds: ['target:container'],
  inputSchema: runtimeToolInputSchemas.container,
};

export class ContainerToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly containers: ContainerEngineService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== containerToolDefinition.name)
      throw new Error('Unknown container tool');
    const receipt = await this.containers.execute(
      { ...invocation.arguments, operation: invocation.operation },
      signal,
    );
    return { structured: { receipt } };
  }
}
