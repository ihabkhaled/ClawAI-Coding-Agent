import {
  backoffMs,
  classifyHttpFailure,
  networkFailureCode,
  retryBudgetSpent,
} from '../core/retry-classifier';
import {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_STATUS,
  RETRY_DEFAULTS,
} from '../core/retry-classifier.constants';

import { RuntimeHttpError } from './runtime-http-error';
import { RuntimeRateLimitedError } from './runtime-rate-limited-error';
import { RuntimeUnavailableError } from './runtime-unavailable-error';

import type { RetryContext, RetryVerdict } from './retry-policy.types';

/**
 * Whether a failed runtime call is worth trying again.
 *
 * Only failures that say "the runtime is not there right now" qualify: a
 * dropped or refused connection, a timeout, a rate limit, a gateway error, and
 * the 500 the runtime answers while its state store is away. Everything else
 * is an answer, and asking again gets the same one — a refused credential, a
 * rejected payload, a missing run — so it is never retried.
 */
export function classifyFailure(error: unknown): RetryVerdict {
  if (error instanceof RuntimeHttpError) return classifyHttp(error);
  const code = networkFailureCode(error);
  return code === undefined ? { retry: false } : { retry: true, code };
}

function classifyHttp(error: RuntimeHttpError): RetryVerdict {
  return classifyHttpFailure({
    status: error.status,
    detail: error.detail,
    retryAfterMs: error.retryAfterMs,
  });
}

export { backoffMs };

/** Waits `ms`, or less when `signal` aborts; it never throws, the caller checks the signal. */
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

/**
 * Decides, failure by failure, whether to wait and try again.
 *
 * One instance covers one call, or one stream: `backoff` is handed each
 * failure, waits when a retry is allowed and throws when it is not. The
 * attempt count and the time budget belong to the instance, so a stream that
 * makes progress calls `reset` and starts its allowance again.
 */
export class Retrier {
  private failures = 0;
  /** Consecutive 429s; any other failure or progress clears it. */
  private rateLimited = 0;
  private startedAt: number;

  constructor(private readonly context: RetryContext) {
    this.startedAt = this.now();
  }

  reset(): void {
    this.failures = 0;
    this.rateLimited = 0;
    this.startedAt = this.now();
  }

  /** Returns after the wait; throws `error` (or a summary of the outage) when the call must fail. */
  async backoff(error: unknown): Promise<void> {
    const { signal } = this.context;
    const verdict = classifyFailure(error);
    if (!verdict.retry || this.aborted()) throw error;
    this.failures += 1;
    this.countRateLimit(verdict.status, error);
    const waitMs =
      verdict.retryAfterMs ?? backoffMs(this.failures, this.context.random ?? Math.random);
    if (this.spent(waitMs)) throw this.failures > 1 ? this.giveUp(error) : error;
    this.context.onRetry?.({
      attempt: this.failures,
      waitMs,
      ...(verdict.status === undefined ? {} : { status: verdict.status }),
      ...(verdict.code === undefined ? {} : { code: verdict.code }),
    });
    await (this.context.sleep ?? abortableSleep)(waitMs, signal);
    if (this.aborted()) throw error;
  }

  /** Counts consecutive 429s and throws once they outlast the rate-limit allowance. */
  private countRateLimit(status: number | undefined, error: unknown): void {
    this.rateLimited = status === RATE_LIMIT_STATUS ? this.rateLimited + 1 : 0;
    if (this.rateLimited >= RATE_LIMIT_MAX_ATTEMPTS) {
      throw new RuntimeRateLimitedError(this.rateLimited, this.elapsed(), error);
    }
  }

  /** True when another try, after `waitMs`, would break the attempt or time allowance. */
  private spent(waitMs: number): boolean {
    return retryBudgetSpent({
      failures: this.failures,
      elapsedMs: this.elapsed(),
      waitMs,
      maxAttempts: this.maxAttempts(),
      budgetMs: this.budgetMs(),
    });
  }

  private aborted(): boolean {
    return this.context.signal?.aborted === true;
  }

  private giveUp(error: unknown): RuntimeUnavailableError {
    return new RuntimeUnavailableError(this.failures, this.elapsed(), error);
  }

  private now(): number {
    return (this.context.now ?? Date.now)();
  }

  private elapsed(): number {
    return this.now() - this.startedAt;
  }

  private maxAttempts(): number {
    return this.context.maxAttempts ?? RETRY_DEFAULTS.maxAttempts;
  }

  private budgetMs(): number {
    return this.context.budgetMs ?? RETRY_DEFAULTS.budgetMs;
  }
}

/** Runs `attempt` until it succeeds, fails for good, or the retry allowance is spent. */
export async function withRetries<T>(context: RetryContext, attempt: () => Promise<T>): Promise<T> {
  const retrier = new Retrier(context);
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      await retrier.backoff(error);
    }
  }
}
