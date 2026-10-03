import type { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
import type { VisionImage } from './vision-tool.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';
import type { HeadlessStreamEvent } from '../headless/headless-session.types';
import type { HeadlessRunRequest } from '../headless/headless-transport.types';

/** `off`: the thread ignores personal memories. `account-default`: left as the account has it. */
export type AgentMemoryMode = 'off' | 'account-default';

/** A provider and model to run on; `provider` defaults to the primary run's. */
export interface AgentModelChoice {
  readonly provider?: string | undefined;
  readonly model: string;
}

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
  /** May return a promise; `signal` aborts a slow call when the run is cancelled. */
  readonly execute: (call: AgentToolCall, signal?: AbortSignal) => unknown;
  /**
   * Asked before `execute`. Returning false sends the model a
   * `PERMISSION_DENIED` result instead of running the tool. Absent means every
   * call the toolkit offers is allowed.
   */
  readonly authorize?: (call: AgentToolCall) => boolean | Promise<boolean>;
  /** Releases anything the toolkit holds open, such as MCP server processes. */
  readonly dispose?: () => void;
}

/** What a transport must do, so a caller can substitute one. */
export interface RuntimeTransportPort {
  readonly signIn: (credentials: { email: string; password: string }) => Promise<string>;
  readonly createThread: (token: string, title: string) => Promise<string>;
  /**
   * Optional: turns the account's personal memories off for a new thread. A
   * transport without it leaves the thread on the account default.
   */
  readonly setThreadMemory?: (token: string, threadId: string, useMemory: boolean) => Promise<void>;
  /** Optional: uploads one image and returns its file id; needed only for `images`. */
  readonly uploadImage?: (token: string, image: VisionImage) => Promise<string>;
  /**
   * Optional: the file ids the backend actually stored on the run's prompt message, or
   * undefined when it cannot tell. Lets the SDK say so when attachments were dropped.
   */
  readonly attachedFileIds?: (
    token: string,
    run: { threadId: string; runId: string },
  ) => Promise<readonly string[] | undefined>;
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
  /**
   * Optional: supplies full definitions for tools the run declared deferred at start
   * (`POST chat-messages/runtime/runs/:runId/tools`). Without it `deferTools` is ignored.
   */
  readonly loadTools?: (
    token: string,
    run: { runId: string; generation: string; threadId: string },
    definitions: readonly unknown[],
    signal?: AbortSignal,
  ) => Promise<{
    catalogVersion: number;
    loaded: readonly { name: string; version: string }[];
  }>;
}

export interface AgentRunOptions {
  readonly prompt: string;
  readonly toolkit: AgentToolkit;
  /** Signed in with when no `token` is given. One of the two is required. */
  readonly credentials?: { email: string; password: string } | undefined;
  /** An access token already issued for this runtime; skips the sign-in. */
  readonly token?: string | undefined;
  /**
   * The server-side allowance requested for the run: `default` (20 turns, 40
   * calls, 256 KiB of results) or `long` (the runtime's maxima). Explicit
   * `budget` fields win over either.
   */
  readonly budgetProfile?: AgentBudgetProfile | undefined;
  /** Overrides individual budget fields, such as `maxModelTurns`. */
  readonly budget?: Readonly<Partial<Record<AgentBudgetField, number>>> | undefined;
  /** Every raw runtime event, in order, before the loop acts on it. */
  readonly onEvent?: ((event: HeadlessStreamEvent) => void) | undefined;
  /** Aborting ends the run as `cancelled`. */
  readonly signal?: AbortSignal | undefined;
  /** Told the run's identity as soon as the runtime accepts it. */
  readonly onStarted?:
    ((run: { runId: string; threadId: string; memory?: AgentMemoryMode }) => void) | undefined;
  /**
   * A NEW thread is asked to ignore the account's stored personal memories, so a
   * repository task is deterministic. `true` keeps the account default. Never
   * applied to a continued thread (`threadId`).
   */
  readonly useMemory?: boolean | undefined;
  /** Told when the backend refused the memory setting (HTTP status only); the run goes on. */
  readonly onMemoryUnchanged?: ((info: { status: number }) => void) | undefined;
  /** Images attached to this run's prompt, already read and checked; see `loadPromptImages`. */
  readonly images?: readonly VisionImage[] | undefined;
  /** Told when the backend kept fewer of the attached images than were sent. */
  readonly onImagesNotDelivered?: ((info: { sent: number; delivered: number }) => void) | undefined;
  /** Defaults to the local gateway when omitted. */
  readonly backendUrl?: string | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** Tried in order, once each, when the model stays rate limited (HTTP 429) at the start. */
  readonly fallbackModels?: readonly AgentModelChoice[] | undefined;
  /** Told when a rate-limited model was replaced by a fallback. */
  readonly onModelFallback?: ((info: { from: string; to: string }) => void) | undefined;
  readonly title?: string | undefined;
  /** Continues this existing thread instead of creating one. */
  readonly threadId?: string | undefined;
  readonly deadlineMs?: number | undefined;
  /** Substituted in tests, and by a caller speaking to a different backend. */
  readonly transport?: RuntimeTransportPort | undefined;
  /**
   * Send rarely used tools as short stubs and load their full definition only when the
   * model asks (`runtime.tool_search`). `true` defers the default set; a list names the tools.
   */
  readonly deferTools?: boolean | readonly string[] | undefined;
  readonly now?: (() => number) | undefined;
}

export interface AgentRunResult {
  readonly outcome: HeadlessOutcome;
  readonly toolCalls: number;
  readonly runId: string;
  readonly threadId: string;
  readonly terminalEvent?: string;
}

/** A budget field the runtime enforces, as named in the run request. */
export type AgentBudgetField = keyof (typeof AGENT_SDK_DEFAULTS)['budget'];

/** A named set of run budget values; see `AGENT_BUDGET_PROFILES`. */
export type AgentBudgetProfile = 'default' | 'long';

/** What running (or refusing) one tool call produced, before it becomes a receipt. */
export interface ToolAttempt {
  readonly structured?: unknown;
  readonly failure?: unknown;
}
