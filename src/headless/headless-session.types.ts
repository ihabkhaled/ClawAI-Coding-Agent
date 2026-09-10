import type { HeadlessOutcome } from '../core/headless-outcome.types';

/** One event as it arrives from the run's stream. */
export interface HeadlessStreamEvent {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Everything the loop needs from the outside world. */
export interface HeadlessSessionPorts {
  /** The run's events, in order, ending when the stream does. */
  readonly events: () => AsyncIterable<HeadlessStreamEvent>;
  /** Executes one requested tool call and submits its result. */
  readonly answerTool: (event: HeadlessStreamEvent) => Promise<void>;
  /** Milliseconds since an arbitrary epoch; injected so a deadline is testable. */
  readonly now: () => number;
  /** How long to wait for the run to end before calling it exhausted. */
  readonly deadlineMs: number;
}

export interface HeadlessRunReport {
  readonly outcome: HeadlessOutcome;
  readonly toolCalls: number;
  /** Absent when the run ended on nothing, which is itself the finding. */
  readonly terminalEvent?: string;
}
