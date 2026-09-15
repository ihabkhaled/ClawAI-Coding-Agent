import type { ContextBudget, TruncationRisk } from './context-budget.types';

/**
 * The share of a context window kept back for the answer.
 *
 * A window is not a budget for the prompt alone: whatever the model says has
 * to fit in the same window, and a request that fills it entirely leaves the
 * model no room to reply. A quarter, bounded, because the fraction that
 * matters is small windows — a quarter of eight thousand is a usable answer,
 * a quarter of a million is more than any reply needs.
 */
export const RESERVED_RESPONSE_FRACTION = 0.25;
export const MIN_RESERVED_RESPONSE_TOKENS = 1_024;
export const MAX_RESERVED_RESPONSE_TOKENS = 32_000;

export function reservedResponseTokens(capacity: number): number {
  const share = Math.round(capacity * RESERVED_RESPONSE_FRACTION);
  return Math.min(MAX_RESERVED_RESPONSE_TOKENS, Math.max(MIN_RESERVED_RESPONSE_TOKENS, share));
}

/**
 * What is left for the prompt once the answer has its room.
 *
 * A capacity that is unknown yields no budget rather than a guess. Automatic
 * routing has not chosen a model yet, and a model may report no window at all;
 * warning about a limit nobody knows would be a warning the user cannot act on.
 */
export function contextBudget(capacity: number | null): ContextBudget | undefined {
  if (capacity === null || capacity <= 0) return undefined;
  const reserved = reservedResponseTokens(capacity);
  return { capacity, reserved, availableForPrompt: Math.max(0, capacity - reserved) };
}

/**
 * How likely this send is to lose something.
 *
 * `over` means the prompt does not fit and the server will drop the oldest of
 * it. `tight` is the warning that matters: still fits, but the next message
 * will not, which is the moment a person can still do something about it
 * cheaply. `none` says nothing, because a meter that always speaks is a meter
 * nobody reads.
 */
export function truncationRisk(
  budget: ContextBudget | undefined,
  promptTokens: number,
): TruncationRisk {
  if (budget === undefined) return 'unknown';
  if (promptTokens > budget.availableForPrompt) return 'over';
  return promptTokens > budget.availableForPrompt * 0.85 ? 'tight' : 'none';
}

/**
 * A rough token count for text about to be sent.
 *
 * Four characters per token is the usual English approximation. It is wrong
 * for code and wrong for Japanese, and it is still the right tool here: the
 * question is "is this about to overflow", not "how much will this cost".
 */
export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
