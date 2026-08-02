import { commandSpecSchema } from '../core/command-spec';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import { runCommandSpec } from './bounded-command-runner';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const structuredCommandToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.command',
  version: '2.0.0',
  description: 'Run one bounded executable and argv without implicit shell interpolation.',
  operations: ['run'],
  riskClasses: ['process', 'network'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.command,
};

export class StructuredCommandToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly files: VscodeFileTransactionAdapter) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (
      invocation.toolName !== structuredCommandToolDefinition.name ||
      invocation.operation !== 'run'
    )
      throw new Error('Unknown structured command operation');
    const specification = commandSpecSchema.parse(invocation.arguments);
    this.files.workspaceRootUri(specification.cwdRootKey);
    const cwdUri = await this.files.uriFor(specification.cwdRootKey, specification.cwd, 'update');
    const result = await runCommandSpec(specification, cwdUri.fsPath, signal);
    return { structured: { ...result } };
  }
}
