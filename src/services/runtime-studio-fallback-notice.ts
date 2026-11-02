import { PLAN_LIMIT_CODE_PATTERN } from '../core/retry-classifier.constants';
import {
  CREDIT_FAILURE_CODE_PATTERN,
  PROVIDER_UNAVAILABLE_CODE_PATTERN,
} from '../sdk/agent-sdk.constants';

import type { ModelFallbackReason } from './runtime-studio.types';

/** The platform appends an error's code to its message as `message (CODE)`. */
const TRAILING_CODE_PATTERN = /\(([A-Z0-9_]+)\)\s*$/u;

/** The code a bare code or a message ending in `(CODE)` carries. */
function codeOf(text: string): string {
  return TRAILING_CODE_PATTERN.exec(text)?.[1] ?? text.trim();
}

/**
 * Whether a bare code, or a message ending in `(CODE)`, is a credit-gate refusal.
 * Only the code counts: text that merely quotes one cannot switch the model.
 */
export function isCreditText(text: string): boolean {
  return CREDIT_FAILURE_CODE_PATTERN.test(codeOf(text));
}

/** Whether the code means another model should take over: spent credit, or a busy or gone model. */
export function isFallbackText(text: string): boolean {
  return isCreditText(text) || PROVIDER_UNAVAILABLE_CODE_PATTERN.test(codeOf(text));
}

/**
 * Why a model was left: spent credit or a reached plan limit when the refusal
 * carries that code, otherwise a rate limit. A plan or credit 429 is about the
 * account, so it must not be reported as the model being busy.
 */
export function fallbackReasonFor(text: string): ModelFallbackReason {
  if (isCreditText(text)) return 'credit';
  return PLAN_LIMIT_CODE_PATTERN.test(codeOf(text)) ? 'plan' : 'rate-limit';
}
