import type { LimitKind } from '../core/retry-classifier.types';

/**
 * ClawAI answered 429 because the account's own allowance is used up, not
 * because a model is busy.
 *
 * Waiting or choosing another model cannot help, so the call fails at once with
 * a sentence that says what happened and what does. The refusal is in `cause`.
 */
export class RuntimeLimitReachedError extends Error {
  constructor(
    readonly kind: LimitKind,
    readonly code: string,
    cause: unknown,
  ) {
    super(limitMessage(kind, code), { cause });
    this.name = 'RuntimeLimitReachedError';
  }
}

function limitMessage(kind: LimitKind, code: string): string {
  if (kind === 'credit') {
    return `Your ClawAI credit is used up (${code}). Top up the credit to continue.`;
  }
  return code === 'PLAN_DAILY_CHAT_LIMIT_EXCEEDED'
    ? `The daily chat limit of your ClawAI plan is used up (${code}). It resets at the daily reset; upgrade the plan to continue now. Another model does not help.`
    : `Your ClawAI plan limit is reached (${code}). Wait for it to reset or upgrade the plan to continue. Another model does not help.`;
}
