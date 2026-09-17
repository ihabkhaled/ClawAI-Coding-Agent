import { TOOL_EXIT_KEYS, TOOL_REASON_KEYS, TOOL_REASON_MAX_LENGTH } from './tool-outcome.constants';

import type { ToolOutcome } from './tool-outcome.types';

const NOTHING: ToolOutcome = { kind: 'none', label: '', value: 0, reason: '' };

/**
 * What a finished call did, in a form something can put on one line.
 *
 * The panel already reports bytes and milliseconds, which answer "did anything
 * come back" and nothing else: a build that failed and a build that passed
 * produce output of much the same size in much the same time. This reads the
 * result's own shape instead.
 *
 * Shape, not a table of tools — for the same reason `toolActivity` does. A
 * per-tool table describes the tools that exist when it is written and then
 * silently stops describing the next one.
 */
export function toolOutcome(structured: unknown): ToolOutcome {
  if (typeof structured !== 'object' || structured === null) return NOTHING;
  const result = structured as Record<string, unknown>;

  // Exit status first. It is the one fact a byte count cannot imply, and the
  // one a reader most wants when a command comes back.
  const exit = firstNumber(result, TOOL_EXIT_KEYS);
  if (exit !== undefined) return { kind: 'code', label: '', value: exit, reason: '' };

  const counted = firstList(result);
  if (counted !== undefined) {
    return { kind: 'count', label: counted.key, value: counted.length, reason: '' };
  }

  const reason = firstReason(result);
  if (reason !== undefined) return { kind: 'reason', label: '', value: 0, reason };

  return NOTHING;
}

function firstNumber(result: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = result[key];
    if (typeof value === 'number' && Number.isInteger(value)) return value;
  }
  return undefined;
}

/**
 * The first list in the result, and what it is called.
 *
 * Keys are read in their own order rather than a fixed one: a result carries
 * at most a few, and which of them is interesting differs per tool. Taking the
 * first list found is arbitrary in principle and right in practice, because a
 * result with two lists has no better answer available without a per-tool rule.
 */
function firstList(
  result: Record<string, unknown>,
): { readonly key: string; readonly length: number } | undefined {
  for (const [key, value] of Object.entries(result)) {
    if (Array.isArray(value)) return { key, length: value.length };
  }
  return undefined;
}

function firstReason(result: Record<string, unknown>): string | undefined {
  for (const key of TOOL_REASON_KEYS) {
    const value = result[key];
    if (typeof value !== 'string') continue;
    const collapsed = value.replace(/\s+/gu, ' ').trim();
    if (collapsed.length === 0) continue;
    return collapsed.length <= TOOL_REASON_MAX_LENGTH
      ? collapsed
      : `${collapsed.slice(0, TOOL_REASON_MAX_LENGTH - 1)}…`;
  }
  return undefined;
}
