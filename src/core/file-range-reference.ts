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
const REFERENCE_PATTERN = /^(.+):(\d+)(?:-(\d+))?$/u;

export function parseFileRangeReference(token: string): FileRangeReference | undefined {
  const match = REFERENCE_PATTERN.exec(token);
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
