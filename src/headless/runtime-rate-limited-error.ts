/**
 * The runtime kept answering 429 for the whole rate-limit allowance.
 *
 * A rate limit is not an outage: waiting a few times is right, waiting for
 * minutes on a model that stays limited is a run that looks hung. This ends the
 * call with a sentence that says what to do, so a caller can switch model or
 * try again later. The last underlying failure is in `cause`.
 */
export class RuntimeRateLimitedError extends Error {
  constructor(
    readonly attempts: number,
    readonly elapsedMs: number,
    cause: unknown,
  ) {
    super(
      `The selected model is rate limited: ClawAI answered 429 ${String(attempts)} times over ${String(Math.round(elapsedMs / 1_000))}s. Choose another model or try again later.`,
      { cause },
    );
    this.name = 'RuntimeRateLimitedError';
  }
}
