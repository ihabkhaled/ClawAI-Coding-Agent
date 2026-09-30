import type { RuntimeTransportPort } from './agent-sdk.types';
import type { AgentMcpOptions } from './mcp-toolkit.types';
import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentPermissions } from './workspace-toolkit.types';
import type { HeadlessExitCode, HeadlessOutcome } from '../core/headless-outcome.types';

/** A token already issued, or credentials to exchange for one. */
export type AgentAuth =
  { readonly token: string } | { readonly email: string; readonly password: string };

export interface AgentConfig {
  readonly auth: AgentAuth;
  /** Every file, command and git call is contained in this directory. */
  readonly workspaceRoot: string;
  /** Defaults to the local gateway when omitted. */
  readonly backendUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  /** Defaults to read and git only; writing and commands are opt-in. */
  readonly permissions?: AgentPermissions | undefined;
  readonly deadlineMs?: number | undefined;
  /** Continues this existing thread; `agent.threadId` is set once a run has started. */
  readonly threadId?: string | undefined;
  /**
   * Operator instructions, up to 20,000 characters. They travel as a framed block
   * ahead of the task and add to the runtime's own instructions; they never
   * appear in events or error text.
   */
  readonly systemPrompt?: string | undefined;
  /** MCP servers offered as `runtime.mcp`; needs the `mcp` grant, added by default. */
  readonly mcp?: AgentMcpOptions | undefined;
  /** `plan`, `ask` or `accept-edits`, applied over `permissions` and its `approve` callback. */
  readonly permissionMode?: AgentPermissionMode | undefined;
  /** Glob lists over tool identifiers, see `AgentToolFilter`. Deny wins. */
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
  /** Substituted in tests, and by a caller speaking to a different backend. */
  readonly transport?: RuntimeTransportPort | undefined;
}

export interface AgentRunCallOptions {
  readonly onEvent?: ((event: AgentEvent) => void) | undefined;
  /** Aborting ends the run as `cancelled` (exit 130). */
  readonly signal?: AbortSignal | undefined;
  /** The runtime's model-turn budget for this run. */
  readonly maxTurns?: number | undefined;
  readonly title?: string | undefined;
}

/** What a run reports while it happens, in the order it happens. */
export type AgentEvent =
  | { readonly type: 'run.started'; readonly runId: string; readonly threadId: string }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool.call';
      readonly toolName: string;
      readonly operation: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'tool.denied'; readonly toolName: string; readonly operation: string }
  | {
      readonly type: 'tool.result';
      readonly toolName: string;
      readonly operation: string;
      readonly ok: boolean;
      readonly message?: string;
    }
  | {
      readonly type: 'runtime';
      readonly name: string;
      readonly payload?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'run.finished'; readonly result: AgentResult };

export interface AgentResult {
  readonly outcome: HeadlessOutcome;
  readonly exitCode: HeadlessExitCode;
  readonly toolCalls: number;
  readonly deniedCalls: number;
  /** The model's streamed answer, concatenated. */
  readonly text: string;
  readonly runId?: string;
  /** The thread the run used; pass it as `threadId` to continue the conversation. */
  readonly threadId?: string;
  readonly terminalEvent?: string;
  /** Why the run could not proceed, when it threw rather than ended. Never a secret. */
  readonly error?: string;
}

export interface Agent {
  /** The conversation this agent continues: the one given, else the first run's. */
  readonly threadId?: string | undefined;
  run(prompt: string, options?: AgentRunCallOptions): Promise<AgentResult>;
}
