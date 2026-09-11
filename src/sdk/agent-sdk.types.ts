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
  ) => AsyncIterable<HeadlessStreamEvent>;
}

export interface AgentRunOptions {
  readonly prompt: string;
  readonly toolkit: AgentToolkit;
  readonly credentials: { email: string; password: string };
  /** Defaults to the local gateway when omitted. */
  readonly backendUrl?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly title?: string;
  readonly deadlineMs?: number;
  /** Substituted in tests, and by a caller speaking to a different backend. */
  readonly transport?: RuntimeTransportPort;
  readonly now?: () => number;
}

export interface AgentRunResult {
  readonly outcome: HeadlessOutcome;
  readonly toolCalls: number;
  readonly runId: string;
  readonly terminalEvent?: string;
}
