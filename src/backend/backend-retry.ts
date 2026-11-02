import {
  backoffMs,
  classifyHttpFailure,
  networkFailureCode,
  retryBudgetSpent,
} from '../core/retry-classifier';
import { RATE_LIMIT_MAX_ATTEMPTS, RATE_LIMIT_STATUS } from '../core/retry-classifier.constants';

import { BackendRequestError } from './backend-errors';
import {
  BACKEND_RETRY_ALLOWANCE,
  START_SAFE_CODES,
  START_SAFE_STATUSES,
} from './backend-retry.constants';

import type {
  BackendRetryClass,
  BackendRetryRequest,
  BackendRetryTuning,
} from './backend-retry.types';
import type { RetryVerdict } from '../core/retry-classifier.types';

/** Waits `ms`, or less when `signal` aborts; the caller checks the signal. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Whether a failed backend call is worth repeating, and what it says about when. */
export function classifyBackendFailure(error: unknown): RetryVerdict {
  if (!(error instanceof BackendRequestError)) {
    const code = networkFailureCode(error);
    return code === undefined ? { retry: false } : { retry: true, code };
  }
  if (error.status === 0) {
    return error.code === undefined ? { retry: false } : { retry: true, code: error.code };
  }
  return classifyHttpFailure({
    status: error.status,
    detail: error.message,
    code: error.code,
    retryAfterMs: error.retryAfterMs,
  });
}

/** Whether the verdict allows another try for this class; `start` needs proof of non-admission. */
function mayRepeat(verdict: RetryVerdict, retryClass: BackendRetryClass): boolean {
  return verdict.retry && (retryClass !== 'start' || startMayRepeat(verdict));
}

/** A start is repeated only when the verdict proves the server never admitted the run. */
function startMayRepeat(verdict: RetryVerdict): boolean {
  if (verdict.status !== undefined) return START_SAFE_STATUSES.includes(verdict.status);
  return verdict.code !== undefined && START_SAFE_CODES.includes(verdict.code);
}

interface RetryState {
  failures: number;
  /** Consecutive 429s; any other failure clears it. */
  rateLimited: number;
  readonly startedAt: number;
}

/** The wait before the next try, or `undefined` when the allowance is spent. */
function planRetry(
  verdict: RetryVerdict,
  state: RetryState,
  retryClass: BackendRetryClass,
  tuning: BackendRetryTuning,
): number | undefined {
  state.failures += 1;
  state.rateLimited = verdict.status === RATE_LIMIT_STATUS ? state.rateLimited + 1 : 0;
  const waitMs = verdict.retryAfterMs ?? backoffMs(state.failures, tuning.random ?? Math.random);
  const allowance = BACKEND_RETRY_ALLOWANCE[retryClass];
  const spent = retryBudgetSpent({
    failures: state.failures,
    elapsedMs: (tuning.now ?? Date.now)() - state.startedAt,
    waitMs,
    maxAttempts: tuning.maxAttempts ?? allowance.maxAttempts,
    budgetMs: tuning.budgetMs ?? allowance.budgetMs,
  });
  return spent || state.rateLimited >= RATE_LIMIT_MAX_ATTEMPTS ? undefined : waitMs;
}

/**
 * Runs `attempt`, repeating it while it fails for a reason that says "not there
 * right now". Throws the last error when the allowance is spent, when the
 * failure is an answer, and at once when `signal` aborts. Only hand this a call
 * that is safe to repeat.
 */
export async function withBackendRetries<T>(
  retryClass: BackendRetryClass,
  attempt: () => Promise<T>,
  signal?: AbortSignal,
  tuning: BackendRetryTuning = {},
): Promise<T> {
  const state: RetryState = { failures: 0, rateLimited: 0, startedAt: (tuning.now ?? Date.now)() };
  for (;;) {
    try {
      return await attempt();
    } catch (error: unknown) {
      const verdict = classifyBackendFailure(error);
      if (!mayRepeat(verdict, retryClass) || signal?.aborted === true) throw error;
      const waitMs = planRetry(verdict, state, retryClass, tuning);
      if (waitMs === undefined) throw error;
      await (tuning.sleep ?? abortableSleep)(waitMs, signal);
      signal?.throwIfAborted();
    }
  }
}

/**
 * The retry class a request may use, or `undefined` when it must not be
 * repeated. A GET is idempotent, so it is repeated by default under the bounded
 * `read` allowance (3 tries, 20 s); a caller opts out with `'never'`. A POST is
 * repeated only when its caller asked for `command` or `start` AND its body
 * really carries an idempotency key: without one a repeat could act twice.
 * Nothing else is ever repeated.
 */
export function retryClassFor(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  requested: BackendRetryRequest | undefined,
  body: unknown,
): BackendRetryClass | undefined {
  if (method === 'GET') return requested === undefined || requested === 'read' ? 'read' : undefined;
  if (method !== 'POST' || (requested !== 'command' && requested !== 'start')) return undefined;
  const key =
    typeof body === 'object' && body !== null
      ? (body as { idempotencyKey?: unknown }).idempotencyKey
      : undefined;
  return typeof key === 'string' && key.length > 0 ? requested : undefined;
}
