/**
 * Which calls may be repeated. `read` is a GET; `command` is a POST that
 * carries an idempotency key, so the platform answers a repeat with the first
 * result. `start` is a run-start POST: narrower than `command`, see
 * `START_SAFE_STATUSES`. A call that is none of these is never retried.
 */
export type BackendRetryClass = 'read' | 'command' | 'start';

/** What a caller may ask for: a class, or `never` to keep a GET from being repeated. A GET asking for nothing is a `read`. */
export type BackendRetryRequest = BackendRetryClass | 'never';

/** The knobs of one retrying call; tests inject `sleep`, `random` and `now`. */
export interface BackendRetryTuning {
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: (() => number) | undefined;
  /** Overrides the attempt allowance of both classes (tests). */
  readonly maxAttempts?: number | undefined;
  /** Overrides the time allowance of both classes (tests). */
  readonly budgetMs?: number | undefined;
}
