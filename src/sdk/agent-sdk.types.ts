import type { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import type { HeadlessOutcome } from '../core/headless-outcome.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';
import type { HeadlessRunRequest } from '../headless/headless-transport.types';

/** One tool call the model asked for, as a caller's toolkit receives it. */
export interface AgentToolCall {
  readonly toolName: string;
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * The tools a run may use, and how to run them.
 *
 * Supplied by the caller rather than chosen here. A library that fixed its own
 * tool set would serve only the application it was extracted from, and the
 * reason to have an SDK at all is that the next application's tools differ.
 *
 * `definitions` goes to the model verbatim and must match the runtime tool
 * contract. `execute` is what happens when the model calls one.
 */
export interface AgentToolkit {
  readonly definitions: readonly unknown[];
  readonly execute: (call: AgentToolCall) => unknown;
  /**
   * Asked before `execute`. Returning false sends the model a
   * `PERMISSION_DENIED` result instead of running the tool. Absent means every
   * call the toolkit offers is allowed.
   */
  readonly authorize?: (call: AgentToolCall) => boolean | Promise<boolean>;
}

/** What a transport must do, so a caller can substitute one. */
export interface RuntimeTransportPort {
  readonly signIn: (credentials: { email: string; password: string }) => Promise<string>;
  readonly createThread: (token: string, title: string) => Promise<string>;
  readonly startRun: (
    token: string,
    request: HeadlessRunRequest,
  ) => Promise<{ runId: string; generation: string }>;
  readonly submitResult: (
    token: string,
    run: { runId: string; generation: string; threadId: string },
    epochs: unknown,
    result: unknown,
  ) => Promise<unknown>;
  readonly events: (
    token: string,
    run: { runId: string; generation: string; threadId: string },
    signal?: AbortSignal,
  ) => AsyncIterable<HeadlessStreamEvent>;
}

export interface AgentRunOptions {
  readonly prompt: string;
  readonly toolkit: AgentToolkit;
  /** Signed in with when no `token` is given. One of the two is required. */
  readonly credentials?: { email: string; password: string } | undefined;
  /** An access token already issued for this runtime; skips the sign-in. */
  readonly token?: string | undefined;
  /** Overrides individual budget fields, such as `maxModelTurns`. */
  readonly budget?: Readonly<Partial<Record<AgentBudgetField, number>>> | undefined;
  /** Every raw runtime event, in order, before the loop acts on it. */
  readonly onEvent?: ((event: HeadlessStreamEvent) => void) | undefined;
  /** Aborting ends the run as `cancelled`. */
  readonly signal?: AbortSignal | undefined;
  /** Told the run's identity as soon as the runtime accepts it. */
  readonly onStarted?: ((run: { runId: string; threadId: string }) => void) | undefined;
  /** Defaults to the local gateway when omitted. */
  readonly backendUrl?: string | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly title?: string | undefined;
  readonly deadlineMs?: number | undefined;
  /** Substituted in tests, and by a caller speaking to a different backend. */
  readonly transport?: RuntimeTransportPort | undefined;
  readonly now?: (() => number) | undefined;
}

export interface AgentRunResult {
  readonly outcome: HeadlessOutcome;
  readonly toolCalls: number;
  readonly runId: string;
  readonly terminalEvent?: string;
}

/** A budget field the runtime enforces, as named in the run request. */
export type AgentBudgetField = keyof (typeof AGENT_SDK_DEFAULTS)['budget'];

/** What running (or refusing) one tool call produced, before it becomes a receipt. */
export interface ToolAttempt {
  readonly structured?: unknown;
  readonly failure?: unknown;
}
