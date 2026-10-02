import { advertisedWorkspaceRootKey } from '../core/workspace-scope';
import { createShellTool, shellDenyProblem } from '../sdk/shell-tool';

import {
  SHELL_DENY_SETTING,
  SHELL_SCRIPT_INPUT_SCHEMA,
  SHELL_SCRIPT_TOOL_DESCRIPTION,
  SHELL_SCRIPT_TOOL_NAME,
  SHELL_SETTING,
} from './opt-in-tools.constants';

import type { OptInToolSettings } from './opt-in-tools.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { ShellTool } from '../sdk/shell-tool.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const shellScriptToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: SHELL_SCRIPT_TOOL_NAME,
  version: '1.0.0',
  description: SHELL_SCRIPT_TOOL_DESCRIPTION,
  operations: ['run'],
  riskClasses: ['process'],
  targetIds: ['target:workspace'],
  inputSchema: SHELL_SCRIPT_INPUT_SCHEMA,
};

/** Resolves a workspace root key to a folder on disk; the studio's file adapter does this. */
export type ShellRootResolver = (rootKey: string) => string;

/**
 * `workspace.shell` in the editor: the host-free shell tool and its static
 * screen, switched on by a setting and approved script by script.
 *
 * The permission policy asks before this runs (the classification is an
 * irreversible local mutation, which every mode asks about), and the approval
 * card shows the script. The static screen then refuses what no approval
 * should unlock, such as `rm -rf` outside the workspace or `curl | sh`. It is
 * not a sandbox, and the tool description says so to the model.
 */
export class ShellScriptToolExecutor implements RuntimeToolExecutorPort {
  private cached: { readonly key: string; readonly tool: ShellTool } | undefined;

  constructor(
    private readonly settings: OptInToolSettings,
    private readonly resolveRoot: ShellRootResolver,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== SHELL_SCRIPT_TOOL_NAME || invocation.operation !== 'run') {
      throw new Error('Unknown shell operation');
    }
    if (!this.settings.shellEnabled()) {
      throw new Error(
        `workspace.shell is off. The user turns it on with the ${SHELL_SETTING} setting.`,
      );
    }
    const { cwdRootKey, ...rest } = invocation.arguments;
    const rootKey = typeof cwdRootKey === 'string' ? cwdRootKey : advertisedWorkspaceRootKey(0);
    const result = await this.tool().execute('run', rest, this.resolveRoot(rootKey), signal);
    return { structured: typeof result === 'object' && result !== null ? { ...result } : {} };
  }

  private tool(): ShellTool {
    const deny = this.settings.shellDeny();
    const key = deny.join('\n');
    if (this.cached?.key === key) return this.cached.tool;
    // A pattern that does not compile would be skipped by the tool: a rule the user wrote
    // that silently does nothing is worse than a refusal that names it.
    const problem = shellDenyProblem(deny);
    if (problem !== undefined) throw new Error(`${SHELL_DENY_SETTING}: ${problem}`);
    const tool = createShellTool({ deny });
    this.cached = { key, tool };
    return tool;
  }
}
