import { CREDIT_FAILURE_CODE_PATTERN } from '../sdk/agent-sdk.constants';

import type { ModelFallbackReason } from './runtime-studio.types';

/** The platform appends an error's code to its message as `message (CODE)`. */
const TRAILING_CODE_PATTERN = /\(([A-Z0-9_]+)\)\s*$/u;

/**
 * Whether a bare code, or a message ending in `(CODE)`, is a credit-gate refusal.
 * Only the code counts: text that merely quotes one cannot switch the model.
 */
export function isCreditText(text: string): boolean {
  return CREDIT_FAILURE_CODE_PATTERN.test(TRAILING_CODE_PATTERN.exec(text)?.[1] ?? text.trim());
}

/** Why a model was left: spent credit when the refusal carries a credit code, otherwise a rate limit. */
export function fallbackReasonFor(text: string): ModelFallbackReason {
  return isCreditText(text) ? 'credit' : 'rate-limit';
}
