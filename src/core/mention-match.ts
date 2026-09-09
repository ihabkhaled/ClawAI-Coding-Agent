import type { MentionMatch, MentionQuery } from './mention-match.types';

/** How many suggestions a mention list offers before it stops being a list. */
export const MENTION_RESULT_LIMIT = 12;

/** Characters that end a mention: a mention is one unbroken token. */
const TERMINATOR = /[\s"'`]/u;

/**
 * The mention the caret is currently inside, if it is inside one.
 *
 * The `@` must open a token — start of text, or after whitespace — so an email
 * address or a `user@host` argument is not mistaken for a file reference. The
 * query ends at the caret rather than at the end of the word, because a caret
 * in the middle of a mention is a user narrowing what they already typed.
 */
export function parseMentionQuery(text: string, caretIndex: number): MentionQuery | undefined {
  const caret = Math.max(0, Math.min(caretIndex, text.length));
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start === -1) return undefined;
  const preceding = start === 0 ? undefined : before[start - 1];
  if (preceding !== undefined && !TERMINATOR.test(preceding)) return undefined;
  const query = before.slice(start + 1);
  if (TERMINATOR.test(query)) return undefined;
  return { start, end: caret, query };
}

/**
 * Where each query character landed, or nothing if the path does not match.
 *
 * A subsequence match, not a substring one: `wcs` finds
 * `workspace-context-service.ts`, which is the whole point of typing three
 * letters instead of twenty-eight. Matching is case-insensitive; the case a
 * user typed is rewarded in the score rather than used to exclude.
 */
function matchPositions(path: string, query: string): number[] | undefined {
  const positions: number[] = [];
  let index = 0;
  for (const character of query) {
    const found = path.toLowerCase().indexOf(character.toLowerCase(), index);
    if (found === -1) return undefined;
    positions.push(found);
    index = found + 1;
  }
  return positions;
}

/**
 * How good a match is, higher being better.
 *
 * The ordering it encodes, in the order it matters: characters that landed in
 * the file name beat characters that landed in a directory, because a person
 * typing three letters is naming a file and not a folder they forgot; runs of
 * consecutive characters beat scattered ones, because that is what "typing the
 * start of a word" looks like; earlier is better than later; and among equals
 * the shorter path wins, since a match spread over a long path matched less of
 * it.
 */
function score(path: string, query: string, positions: readonly number[]): number {
  const nameStart = path.lastIndexOf('/') + 1;
  let total = 0;
  positions.forEach((position, index) => {
    if (position >= nameStart) total += 12;
    if (index > 0 && position === (positions[index - 1] ?? -2) + 1) total += 8;
    if (position === nameStart || position === 0) total += 10;
    if (path[position] === query[index]) total += 2;
    total -= Math.min(position, 20) / 10;
  });
  return total - path.length / 100;
}

/**
 * The paths worth offering for a query, best first.
 *
 * An empty query offers the shortest paths rather than nothing: the list is
 * how a mention is discovered, and an empty list the moment `@` is typed
 * teaches the user there is nothing there.
 */
export function rankMentionCandidates(
  paths: readonly string[],
  query: string,
  limit: number = MENTION_RESULT_LIMIT,
): MentionMatch[] {
  const matches: MentionMatch[] = [];
  for (const path of paths) {
    if (query.length === 0) {
      matches.push({ path, score: -path.length, positions: [] });
      continue;
    }
    const positions = matchPositions(path, query);
    if (positions === undefined) continue;
    matches.push({ path, score: score(path, query, positions), positions });
  }
  return matches
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(0, limit));
}

/** The composer text with the mention under the caret replaced by a path. */
export function applyMention(
  text: string,
  mention: MentionQuery,
  path: string,
): { text: string; caretIndex: number } {
  // A folder keeps the mention open so the next keystroke narrows inside it;
  // a file closes it with a space, because the mention is finished — unless
  // the text already continues with one, which is the ordinary case of editing
  // a mention in the middle of a sentence.
  const following = text.slice(mention.end);
  const separator = path.endsWith('/') || TERMINATOR.test(following[0] ?? '') ? '' : ' ';
  const inserted = `@${path}${separator}`;
  return {
    text: `${text.slice(0, mention.start)}${inserted}${following}`,
    caretIndex: mention.start + inserted.length,
  };
}
