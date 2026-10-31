import { networkFailureCode } from '../core/retry-classifier';

import { BackendRequestError, backendTransportFailureMessage } from './backend-errors';

import type { ResponseLease } from './response-lease';

interface LeaseRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

/**
 * One HTTP exchange under a timeout. A failed connection becomes a
 * `BackendRequestError` that keeps the transport code, so the retrier can tell
 * a dropped socket from a timeout; a caller's abort is rethrown untouched.
 */
export async function fetchLease(
  fetcher: typeof fetch,
  url: string,
  request: LeaseRequest,
): Promise<ResponseLease> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(new Error('ClawAI request timed out.'));
  }, request.timeoutMs);
  const signal =
    request.signal === undefined
      ? timeoutController.signal
      : AbortSignal.any([request.signal, timeoutController.signal]);
  try {
    const response = await fetcher(url, {
      method: request.method,
      headers: request.headers,
      signal,
      ...(request.body === undefined ? {} : { body: request.body }),
    });
    return {
      ...(request.signal === undefined ? {} : { callerSignal: request.signal }),
      release: () => {
        clearTimeout(timeout);
      },
      response,
      signal,
    };
  } catch (error: unknown) {
    clearTimeout(timeout);
    request.signal?.throwIfAborted();
    const message = backendTransportFailureMessage(error, timeoutController.signal.aborted);
    throw new BackendRequestError(message, 0, true, { code: networkFailureCode(error) });
  }
}
