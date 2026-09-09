/**
 * Parses the `path:L` / `path:L-L` line-range reference syntax a user can
 * type directly into a prompt to pull an exact range of a workspace file
 * into context, independent of the active editor's selection.
 *
 * Deliberately a plain scanner over whitespace-delimited tokens rather than
 * an editor-integrated mention with fuzzy matching — that affordance is a
 * separate, later feature. This is the parser it will emit its final,
 * range-bearing shape through, landing first so the shape is not designed
 * twice.
 */
export interface FileRangeReference {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

const MAX_REFERENCES_PER_PROMPT = 20;

/**
 * A reference may be written with a leading `@`, which is what the mention
 * affordance inserts. The two spellings mean the same thing: `@src/a.ts:1-9`
 * and `src/a.ts:1-9` are one reference, and a user who types either should not
 * have to learn that only one of them works.
 */
function withoutMentionMarker(token: string): string {
  return token.startsWith('@') ? token.slice(1) : token;
}
const REFERENCE_PATTERN = /^(.+):(\d+)(?:-(\d+))?$/u;

export function parseFileRangeReference(token: string): FileRangeReference | undefined {
  const match = REFERENCE_PATTERN.exec(withoutMentionMarker(token));
  if (match === null) return undefined;
  const [, path, startText, endText] = match;
  if (path === undefined || startText === undefined) return undefined;
  // A URL's `://` reads as a path with a trailing `:port`, e.g.
  // `https://example.com:8080`. That is not a file reference.
  if (path.includes('://')) return undefined;
  const startLine = Number.parseInt(startText, 10);
  const endLine = endText === undefined ? startLine : Number.parseInt(endText, 10);
  if (startLine < 1 || endLine < startLine) return undefined;
  return { path, startLine, endLine };
}

export function findFileRangeReferences(promptText: string): FileRangeReference[] {
  const seen = new Set<string>();
  const references: FileRangeReference[] = [];
  for (const token of promptText.split(/\s+/u)) {
    if (references.length >= MAX_REFERENCES_PER_PROMPT) break;
    const reference = parseFileRangeReference(token);
    if (reference === undefined) continue;
    const key = `${reference.path}:${String(reference.startLine)}-${String(reference.endLine)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
  }
  return references;
}

/**
 * Whole-file `@path` mentions, which name a file without naming a range.
 *
 * Separate from the ranged form because they answer a different question —
 * "read this file" rather than "read these lines" — and because only the
 * `@` spelling means it. A bare `src/a.ts` in a sentence is prose; a user
 * writes the `@` when they mean to hand a file over.
 *
 * Trailing sentence punctuation is dropped so `@src/a.ts.` works, and a token
 * that carries a range is left to `findFileRangeReferences` rather than being
 * claimed twice.
 */
export function findMentionedPaths(promptText: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const token of promptText.split(/\s+/u)) {
    if (paths.length >= MAX_REFERENCES_PER_PROMPT) break;
    if (!token.startsWith('@')) continue;
    const path = token.slice(1).replace(/[.,;:!?)\]]+$/u, '');
    if (path.length === 0 || path.includes('://')) continue;
    if (parseFileRangeReference(token) !== undefined) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}
