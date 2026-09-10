import { estimateTokens } from './token-telemetry';

import type { ReasoningStatus } from './reasoning-visibility.types';

/**
 * The stream event that carries a model's private reasoning.
 *
 * Providers that expose extended thinking send the chain of thought as its own
 * delta so a client can show progress without mixing it into the answer. The
 * panel has only ever rendered a token count from it, but the text itself was
 * still posted verbatim across the host-to-webview boundary, where it sat in
 * the message queue and in anything that inspects the webview. Counting in the
 * webview is a convention; dropping the text on the host is an invariant.
 */
const REASONING_DELTA = 'REASONING_DELTA';

/**
 * The field names a reasoning event may use for its text. `delta` is what the
 * backend sends today; the other two are the shapes the same event takes on
 * providers that report a whole reasoning block instead of a stream, and a
 * future backend that starts forwarding one must not slip past this guard.
 */
const TEXT_FIELDS = ['delta', 'content', 'reasoning'] as const;

export function isReasoningEvent(event: Record<string, unknown>): boolean {
  return event.type === REASONING_DELTA;
}

function reasoningText(event: Record<string, unknown>): string {
  for (const field of TEXT_FIELDS) {
    const value = event[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

/**
 * Strips a reasoning event down to its size before it leaves the host.
 *
 * Every other event passes through unchanged and by identity, so this can sit
 * on the single `postEvent` chokepoint without the four producers upstream
 * needing to know it exists. A reasoning event keeps its type — the panel still
 * has to know the model is thinking — loses every text field, and gains the
 * token count the panel used to compute for itself.
 */
export function redactReasoningEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (!isReasoningEvent(event)) {
    return event;
  }
  const carriesText = (key: string): boolean => TEXT_FIELDS.some((field) => field === key);
  return {
    ...Object.fromEntries(Object.entries(event).filter(([key]) => !carriesText(key))),
    redacted: true,
    deltaTokens: estimateTokens(reasoningText(event)).total,
  };
}

/**
 * Folds a redacted event into the running status for one request. An event
 * whose count is missing or unusable still advances the segment counter: the
 * model demonstrably thought, and reporting nothing would be a worse lie than
 * reporting a segment worth zero tokens.
 */
export function accumulateReasoning(
  previous: ReasoningStatus | undefined,
  event: Record<string, unknown>,
): ReasoningStatus {
  const base = previous ?? { tokens: 0, segments: 0 };
  if (!isReasoningEvent(event)) {
    return base;
  }
  const reported = event.deltaTokens;
  const tokens =
    typeof reported === 'number' && Number.isFinite(reported) ? Math.max(0, reported) : 0;
  return { tokens: base.tokens + Math.round(tokens), segments: base.segments + 1 };
}
