/** Whether a failure is worth trying again, and what it says about when. */
export interface RetryVerdict {
  readonly retry: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly code?: string;
}

/** The plain shape of an HTTP refusal, whatever class carried it. */
export interface HttpFailureShape {
  readonly status: number;
  /** The body or message text; a 500 or 400 is judged by what it says. */
  readonly detail: string;
  /** The server's `Retry-After`, in milliseconds and already capped. */
  readonly retryAfterMs?: number | undefined;
  /** The platform error `code` from the body, when it has one. */
  readonly code?: string | undefined;
}

/** Which allowance a 429 says is used up. */
export type LimitKind = 'plan' | 'credit';

/** The numbers the allowance check reads. */
export interface RetryBudgetState {
  /** Failures so far, the one being judged included. */
  readonly failures: number;
  readonly elapsedMs: number;
  readonly waitMs: number;
  readonly maxAttempts: number;
  readonly budgetMs: number;
}
