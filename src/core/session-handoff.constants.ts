import type { BackoffPolicy } from './session-handoff.types';

/** Output kept per stream in a handoff message. */
export const HANDOFF_OUTPUT_TAIL_CHARACTERS = 4_000;

/** 2s growing to 15s, at most 120 reads: about twenty-five minutes. */
export const ATTACH_BACKOFF_POLICY: BackoffPolicy = {
  initialMs: 2_000,
  factor: 1.5,
  maxDelayMs: 15_000,
  maxAttempts: 120,
};

/** Backend statuses that mean the runner did not run the command to completion. */
export const STOPPED_TASK_STATUSES: ReadonlySet<string> = new Set([
  'CANCELLED',
  'EXPIRED',
  'REJECTED',
]);
