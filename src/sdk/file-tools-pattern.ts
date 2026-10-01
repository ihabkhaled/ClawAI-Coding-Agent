import { FILE_GLOB_MAX_WILDCARDS, FILE_REGEX_MAX_QUANTIFIERS } from './file-tools.constants';

/** A group whose body holds a quantifier or an alternation, itself quantified: `(a+)+`, `(a|a)*`. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*(?:[+*]|\{\d|\|)(?:[^()\\]|\\.)*\)[+*{]/u;

/** A quantifier outside a character class; escaped characters do not count. */
const QUANTIFIER = /(?<!\\)(?:[*+?]|\{\d+(?:,\d*)?\})/gu;

/** Refuses a glob with so many wildcards that matching it could take unbounded time. */
export function assertGlobCost(operation: string, argument: string, pattern: string): void {
  const wildcards = pattern.match(/[*?{]/gu)?.length ?? 0;
  if (wildcards > FILE_GLOB_MAX_WILDCARDS) {
    throw new Error(
      `workspace.file ${operation}: "${argument}" has ${String(wildcards)} wildcards; use at most ${String(FILE_GLOB_MAX_WILDCARDS)}.`,
    );
  }
}

/**
 * Refuses a regular expression whose shape can backtrack catastrophically:
 * a quantified group that itself repeats or alternates, a back-reference, or
 * more quantifiers than a code search needs. The error says how to rewrite it.
 */
export function assertSafeRegex(operation: string, source: string): void {
  const reason = unsafeReason(source);
  if (reason !== undefined) {
    throw new Error(
      `workspace.file ${operation}: "regex" refused (${reason}). Use a simpler pattern without nested quantifiers, or search a literal "query".`,
    );
  }
}

function unsafeReason(source: string): string | undefined {
  if (NESTED_QUANTIFIER.test(source)) return 'nested quantifier can backtrack catastrophically';
  if (/\\[1-9]|\\k</u.test(source)) return 'back-references are not allowed';
  const quantifiers = source.match(QUANTIFIER)?.length ?? 0;
  if (quantifiers > FILE_REGEX_MAX_QUANTIFIERS) {
    return `${String(quantifiers)} quantifiers; at most ${String(FILE_REGEX_MAX_QUANTIFIERS)}`;
  }
  return undefined;
}
