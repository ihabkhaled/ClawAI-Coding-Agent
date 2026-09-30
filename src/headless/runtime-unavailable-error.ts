/**
 * The runtime stayed unreachable for the whole retry allowance.
 *
 * Kept apart from `RuntimeHttpError` so it reads as what it is — an outage —
 * and never as a refused credential, which is the only HTTP failure with a
 * meaning of its own to the exit code. The last underlying failure is in the
 * message and in `cause`.
 */
export class RuntimeUnavailableError extends Error {
  constructor(
    readonly attempts: number,
    readonly elapsedMs: number,
    cause: unknown,
  ) {
    const last = cause instanceof Error ? cause.message : 'unknown error';
    super(
      `The ClawAI runtime stayed unavailable: gave up after ${String(attempts)} attempts over ${String(Math.round(elapsedMs / 1_000))}s. Last error: ${last}`,
      { cause },
    );
    this.name = 'RuntimeUnavailableError';
  }
}
