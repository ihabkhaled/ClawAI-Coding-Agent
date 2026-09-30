import { doneCheckProblem, doneChecksProblem } from '../sdk/done-checks';

import type { DoneCheck } from '../sdk/done-checks.types';

/**
 * Splits a command line into words without a shell: spaces separate, and
 * `"..."` or `'...'` keep spaces (and the other quote) inside one word. There
 * are no escapes, so a Windows path keeps its backslashes. A string is the
 * mistake: an unterminated quote.
 */
export function splitCommandLine(text: string): string[] | string {
  const words: string[] = [];
  let word = '';
  let started = false;
  let quote: string | undefined;
  for (const char of text) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (quote !== undefined) return `unterminated ${quote} quote.`;
  if (started) words.push(word);
  return words;
}

/** `--done-check "<label>=<executable> <args...>"`, or the message naming what is wrong. */
export function parseDoneCheckFlag(text: string): DoneCheck | string {
  const at = text.indexOf('=');
  if (at < 1) return `--done-check needs "<label>=<executable> <args...>", got "${text}".`;
  const words = splitCommandLine(text.slice(at + 1));
  if (typeof words === 'string') return `--done-check "${text.slice(0, at)}": ${words}`;
  const [executable, ...args] = words;
  if (executable === undefined) return `--done-check "${text.slice(0, at)}" has no executable.`;
  const check: DoneCheck = { label: text.slice(0, at).trim(), executable, args };
  return doneCheckProblem(check) ?? check;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isOptionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || typeof value === 'number';

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

function fileEntry(entry: unknown, index: number): DoneCheck | string {
  const at = `--done-check-file entry ${String(index + 1)}`;
  if (!isRecord(entry)) return `${at} must be an object.`;
  const { label, executable, args, cwd, timeoutMs } = entry;
  if (typeof label !== 'string' || typeof executable !== 'string') {
    return `${at} needs a string label and executable.`;
  }
  if (!isStringList(args)) return `${at} needs args: an array of strings.`;
  if (!isOptionalString(cwd)) return `${at}: cwd must be a string.`;
  if (!isOptionalNumber(timeoutMs)) return `${at}: timeoutMs must be a number.`;
  const check: DoneCheck = { label, executable, args, cwd, timeoutMs };
  const problem = doneCheckProblem(check);
  return problem === undefined ? check : `${at}: ${problem}`;
}

/** The checks in a `--done-check-file` JSON text, or the message naming what is wrong. */
export function parseDoneCheckFile(text: string): readonly DoneCheck[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return '--done-check-file is not valid JSON.';
  }
  if (!Array.isArray(parsed)) return '--done-check-file must be a JSON array of checks.';
  const checks: DoneCheck[] = [];
  for (const [index, entry] of parsed.entries()) {
    const check = fileEntry(entry, index);
    if (typeof check === 'string') return check;
    checks.push(check);
  }
  return doneChecksProblem(checks) ?? checks;
}

/** Every `--done-check` flag, parsed; a string is the first mistake. */
export function parseDoneCheckFlags(values: readonly string[]): readonly DoneCheck[] | string {
  const checks: DoneCheck[] = [];
  for (const value of values) {
    const check = parseDoneCheckFlag(value);
    if (typeof check === 'string') return check;
    checks.push(check);
  }
  return doneChecksProblem(checks) ?? checks;
}
