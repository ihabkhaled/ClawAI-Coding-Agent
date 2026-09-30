import { parseRetryAfter } from './retry-after';

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
    readonly detail: string,
    /** The server's `Retry-After`, in milliseconds and already capped. */
    readonly retryAfterMs?: number,
  ) {
    super(`${path} refused: HTTP ${String(status)} ${detail}`.trim());
    this.name = 'RuntimeHttpError';
  }

  /** The error for a non-2xx response, carrying its `Retry-After`. */
  static fromResponse(path: string, response: Response, body: string): RuntimeHttpError {
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    return new RuntimeHttpError(path, response.status, body.slice(0, 300), retryAfterMs);
  }
}
