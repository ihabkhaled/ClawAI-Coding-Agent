import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { GitAgentService } from '../services/git-agent-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const gitToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.git',
  version: '2.0.0',
  description: 'Inspect and mutate Git repositories through exact structured operations.',
  operations: [
    'status',
    'diff',
    'log',
    'blame',
    'branches',
    'tags',
    'remotes',
    'worktrees',
    'conflicts',
    'submodules',
    'topology',
    'create-branch',
    'create-worktree',
    'stage',
    'unstage',
    'commit',
    'stash',
    'merge',
    'rebase',
    'cherry-pick',
    'revert',
    'fetch',
    'pull',
    'push',
    'tag',
  ],
  riskClasses: ['inspect', 'git-mutate', 'network', 'publish', 'destructive'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.git,
};

export class GitToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly git: GitAgentService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== gitToolDefinition.name) throw new Error('Unknown Git tool');
    const receipt = await this.git.execute(
      { ...invocation.arguments, operation: invocation.operation },
      signal,
    );
    return { structured: { receipt } };
  }
}
