/**
 * Compiles a `*` glob into a matcher.
 *
 * Every other character is escaped, so the only metacharacter is `*` and the
 * result contains no nested quantifier. A pattern from an untrusted file can
 * therefore be slow at worst, never catastrophic.
 */
export function globMatches(pattern: string, value: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join(String.raw`[\s\S]*`);
  return new RegExp(`^${source}$`, 'iu').test(value);
}
