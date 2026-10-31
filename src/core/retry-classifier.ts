import {
  BUSY_BODY_PATTERN,
  CAUSE_DEPTH,
  NETWORK_FAILURE_CODE,
  RETRY_DEFAULTS,
  TRANSIENT_NETWORK_CODES,
  TRANSIENT_NETWORK_MESSAGE,
  TRANSIENT_STATUSES,
  UNAVAILABLE_BODY_PATTERN,
} from './retry-classifier.constants';

import type { HttpFailureShape, RetryBudgetState, RetryVerdict } from './retry-classifier.types';

/**
 * Whether an HTTP refusal says "not there right now": a timeout, a rate limit,
 * a gateway error, the 500 of an unavailable state store, or a busy provider.
 * Everything else is an answer, and asking again gets the same one.
 */
export function classifyHttpFailure(failure: HttpFailureShape): RetryVerdict {
  const { status, detail } = failure;
  const transient =
    TRANSIENT_STATUSES.includes(status) ||
    (status === 500 && UNAVAILABLE_BODY_PATTERN.test(detail)) ||
    (status === 400 && BUSY_BODY_PATTERN.test(detail));
  if (!transient) return { retry: false };
  return {
    retry: true,
    status,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  };
}

/** The transport code of a dropped connection, looking through `cause` wrappers. */
export function networkFailureCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.includes(code)) return code;
    if (TRANSIENT_NETWORK_MESSAGE.test(current.message)) {
      return depth === 0 ? (deepCode(current.cause) ?? NETWORK_FAILURE_CODE) : NETWORK_FAILURE_CODE;
    }
    current = current.cause;
  }
  return undefined;
}

function deepCode(error: unknown): string | undefined {
  const code = error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && TRANSIENT_NETWORK_CODES.includes(code) ? code : undefined;
}

/** The wait before retry `attempt` (1 for the first), grown, jittered and capped. */
export function backoffMs(attempt: number, random: () => number): number {
  const grown = RETRY_DEFAULTS.baseMs * RETRY_DEFAULTS.factor ** (attempt - 1);
  const spread = 1 + RETRY_DEFAULTS.jitter * (random() * 2 - 1);
  return Math.round(Math.min(RETRY_DEFAULTS.capMs, grown * spread));
}

/** True when another try, after the wait, would break the attempt or time allowance. */
export function retryBudgetSpent(state: RetryBudgetState): boolean {
  return state.failures >= state.maxAttempts || state.elapsedMs + state.waitMs > state.budgetMs;
}
