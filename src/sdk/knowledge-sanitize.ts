import { KNOWLEDGE_HIDDEN_RANGES } from './knowledge-tool.constants';

/**
 * The text without control, zero-width and bidirectional characters: they hide
 * text from a reader but not from a model, which is how an instruction is smuggled
 * into a file that looks harmless in review.
 */
export function withoutHidden(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (!KNOWLEDGE_HIDDEN_RANGES.some(([from, to]) => code >= from && code <= to)) out += char;
  }
  return out;
}

/**
 * An integer argument as models send it: `178` or `"178"`. Anything else, such as
 * 1.5, "abc" or a negative number, is undefined, never silently rounded.
 */
export function integerArgument(value: unknown): number | undefined {
  const parsed =
    typeof value === 'string' && /^\d{1,9}$/u.test(value.trim()) ? Number(value) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) ? parsed : undefined;
}
