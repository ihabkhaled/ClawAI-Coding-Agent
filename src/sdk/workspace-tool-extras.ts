import type { AgentToolCall } from './agent-sdk.types';
import type { WorkspaceToolExtras } from './workspace-tool-extras.types';
import type { ToolLimits } from '../headless/headless-main.types';

/** What an optional tool answered; absent when the call is not for one of them. */
export interface ExtraToolRun {
  readonly value: unknown;
}

/**
 * Runs a call for one of the optional tools (plan, gates, http, shell) when it
 * is built for this run. Returns undefined for any other call, so the caller
 * falls through to files, commands, git and notes.
 */
export function runExtraTool(
  call: AgentToolCall,
  limits: ToolLimits,
  signal: AbortSignal | undefined,
  extras: WorkspaceToolExtras,
): ExtraToolRun | undefined {
  const { operation, arguments: args } = call;
  switch (call.toolName) {
    case 'task.plan':
      return extras.plan && { value: extras.plan.execute(operation, args, signal) };
    case 'code.gates':
      return extras.gates && { value: extras.gates.execute(operation, args, limits, signal) };
    case 'http.request':
      return extras.http && { value: extras.http.execute(args, signal) };
    case 'workspace.shell':
      return (
        extras.shell && { value: extras.shell.execute(operation, args, limits.workspace, signal) }
      );
    default:
      return undefined;
  }
}
