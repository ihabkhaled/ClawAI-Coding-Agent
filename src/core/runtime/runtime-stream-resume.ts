import {
  RUNTIME_STREAM_TRANSPORT_ATTEMPTS,
  RUNTIME_STREAM_TRANSPORT_BACKOFF_MS,
} from './runtime-stream-resume.constants';

import type { RuntimeDispatchState } from './runtime-event-stream.types';

/**
 * Wraps a failure that came from the connection rather than from the run.
 *
 * The tag is what keeps the retry honest. Opening the stream and reading from
 * it are the only operations that can fail because the network did, and only
 * those are worth repeating. Everything else that throws inside the follow
 * loop — an unreadable frame, a platform error envelope, a tool dispatch that
 * failed — reports something the backend actually said, and reopening would
 * replay the same frame and bury the reason under six silent retries.
 */
export class RuntimeStreamTransportError extends Error {
  constructor(readonly reason: unknown) {
    super(
      reason instanceof Error
        ? `Runtime event stream transport failed: ${reason.message}`
        : 'Runtime event stream transport failed',
    );
    this.name = 'RuntimeStreamTransportError';
  }
}

/** Rethrows a transport-layer failure tagged so the follow loop may resume it. */
export function asStreamTransportFailure(reason: unknown): never {
  throw new RuntimeStreamTransportError(reason);
}

/**
 * Decides whether a broken stream may be reopened from the same cursor.
 *
 * Only transport trouble qualifies. A cancelled run and a failed tool dispatch
 * are decisions the run has already made, and reopening the stream would hide
 * them behind a retry — so both end the follow loop exactly as before. What is
 * left is the connection itself dying, which says nothing about the run.
 */
export function isResumableStreamFailure(
  error: unknown,
  attempt: number,
  signal: AbortSignal,
  dispatchState: RuntimeDispatchState,
): boolean {
  if (!(error instanceof RuntimeStreamTransportError)) return false;
  if (signal.aborted) return false;
  if (dispatchState.failure !== undefined) return false;
  // `attempt` counts from one, so the bound is inclusive: six attempts means
  // the sixth is allowed, and the sixth backoff entry is reachable.
  return attempt <= RUNTIME_STREAM_TRANSPORT_ATTEMPTS;
}

export function streamResumeDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RUNTIME_STREAM_TRANSPORT_BACKOFF_MS.length) - 1;
  return RUNTIME_STREAM_TRANSPORT_BACKOFF_MS[index] ?? 0;
}

/** Waits out the backoff, giving up early if the run is cancelled meanwhile. */
export function waitBeforeStreamResume(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
