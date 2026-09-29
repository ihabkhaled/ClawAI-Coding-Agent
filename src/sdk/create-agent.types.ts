import type { RuntimeTransportPort } from './agent-sdk.types';
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
  readonly terminalEvent?: string;
  /** Why the run could not proceed, when it threw rather than ended. Never a secret. */
  readonly error?: string;
}

export interface Agent {
  run(prompt: string, options?: AgentRunCallOptions): Promise<AgentResult>;
}
