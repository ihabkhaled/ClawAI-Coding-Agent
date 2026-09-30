import type { CloudTask } from '../backend/remote-session-contracts';

/** What a runner command amounts to for the person reading it. */
export type SessionOutcome = 'running' | 'succeeded' | 'failed' | 'stopped';

export interface HandoffInput {
  readonly task: CloudTask;
  readonly runnerName: string;
}

/** Bounded polling: a stuck runner cannot keep a window polling forever. */
export interface BackoffPolicy {
  readonly initialMs: number;
  readonly factor: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
}

export interface BoundedPollOptions<T> {
  readonly read: () => Promise<T>;
  readonly isDone: (value: T) => boolean;
  readonly onUpdate: (value: T) => void;
  readonly isCancelled: () => boolean;
  readonly policy: BackoffPolicy;
  readonly sleep: (ms: number) => Promise<void>;
}
