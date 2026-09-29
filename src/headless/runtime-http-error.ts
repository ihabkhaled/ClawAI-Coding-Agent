/**
 * A refusal from the runtime, with the status kept as a number.
 *
 * The headless exit code depends on why a call failed — a refused credential
 * is exit 3, anything else is 1 — and parsing that back out of a message
 * string is how a reworded message silently changes a pipeline's behaviour.
 */
export class RuntimeHttpError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    detail: string,
  ) {
    super(`${path} refused: HTTP ${String(status)} ${detail}`.trim());
    this.name = 'RuntimeHttpError';
  }
}
