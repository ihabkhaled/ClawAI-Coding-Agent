/** Told to the caller before each wait; also the `run.retrying` event's payload. */
export interface RetryNotice {
  /** 1 for the first retry. */
  readonly attempt: number;
  readonly waitMs: number;
  /** The HTTP status that caused the retry, when there was one. */
  readonly status?: number;
  /** A network error code, when there was no HTTP status. */
  readonly code?: string;
}

/** The knobs a caller may turn; tests inject `sleep`, `random` and `now`. */
export interface RetryTuning {
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => number) | undefined;
  readonly maxAttempts?: number | undefined;
  readonly budgetMs?: number | undefined;
}

/** What one retrying call needs beyond the tuning. */
export interface RetryContext extends RetryTuning {
  /** Ends every wait and every attempt; a caller's cancel and its time guard both arrive here. */
  readonly signal?: AbortSignal | undefined;
  readonly onRetry?: ((notice: RetryNotice) => void) | undefined;
}

/** Whether a failure is worth trying again, and what it says about when. */
export interface RetryVerdict {
  readonly retry: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly code?: string;
}
