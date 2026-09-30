import {
  TOOL_RESULT_CUT_MARKER,
  TOOL_RESULT_MAX_CHARS,
  TOOL_RESULT_MIN_FIELD_CHARS,
} from './file-tools.constants';

const PREVIEW_CHARS = 40_000;

function json(value: unknown): string {
  // JSON.stringify(undefined) is undefined at runtime though typed string.
  return [JSON.stringify(value)].join('');
}

function size(value: unknown): number {
  return json(value).length;
}

/** Copies `value` with every string cut to `cap` characters; reports whether any was. */
function capStrings(value: unknown, cap: number, cut: { any: boolean }): unknown {
  if (typeof value === 'string') {
    if (value.length <= cap) return value;
    cut.any = true;
    return value.slice(0, cap) + TOOL_RESULT_CUT_MARKER;
  }
  if (Array.isArray(value)) return value.map((entry) => capStrings(entry, cap, cut));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, capStrings(entry, cap, cut)]),
    );
  }
  return value;
}

function markTruncated(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return { ...value, truncated: true };
}

/**
 * Makes sure no tool result can be rejected for size.
 *
 * The backend refuses a result whose string field is over its limit, and a
 * refusal ends the model's turn with an error it cannot act on. So whatever a
 * tool returns is bounded here, last: string fields are cut (halving the cap
 * until the whole result fits) and the object is marked `truncated: true` so
 * the model knows it saw a part. A result that is large for another reason,
 * such as thousands of small entries, is replaced by a bounded preview.
 */
export function guardToolResult(value: unknown): unknown {
  return boundResult(asRecord(value));
}

/**
 * The run protocol requires `structured` to be a JSON object. A tool that
 * returns a string, number, array or nothing would have its result refused with
 * HTTP 400, which ends the whole run: the notes tool once did exactly that.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value: value === undefined ? null : value };
}

function boundResult(value: unknown): unknown {
  if (size(value) <= TOOL_RESULT_MAX_CHARS) return value;
  let cap = Math.floor(TOOL_RESULT_MAX_CHARS / 2);
  while (cap >= TOOL_RESULT_MIN_FIELD_CHARS) {
    const cut = { any: false };
    const capped = capStrings(value, cap, cut);
    const marked = cut.any ? markTruncated(capped) : capped;
    if (size(marked) <= TOOL_RESULT_MAX_CHARS) return marked;
    cap = Math.floor(cap / 2);
  }
  return {
    truncated: true,
    note: 'The result was too large and was cut to a preview. Ask for less.',
    preview: json(value).slice(0, PREVIEW_CHARS),
  };
}
