/**
 * The audit a child's patch passes before it touches the workspace.
 *
 * The scope check judges the file names a patch carries. It cannot see what the
 * patch DOES to them: a rename deletes a source that is not in the name list, a
 * symbolic link carries a write through to wherever it points, and a submodule
 * entry makes the next `git submodule update` fetch from a URL the child chose.
 * So the patch text itself is read, line by line, and only plain files are let
 * through: created, changed or deleted, never renamed, copied or linked.
 */

/** The file modes a merged change may have: a regular file, with or without the executable bit. */
const PLAIN_MODES: ReadonlySet<string> = new Set(['100644', '100755']);

/** The longest header line read; a real one holds two paths, which the OS limits. */
const MAX_HEADER_CHARS = 4_096;

const MODE_LINE = /^(?:new file mode|deleted file mode|old mode|new mode) (\d+)$/u;
const INDEX_LINE = /^index [0-9a-f]+\.\.[0-9a-f]+ (\d+)$/u;
const MOVE_LINE = /^(?:rename|copy) (?:from|to) |^similarity index |^dissimilarity index /u;
const SAME_PATH = /^diff --git (?:a\/(.+) b\/\1|"a\/(.+)" "b\/\2")$/u;

function modeProblem(line: string): string | undefined {
  const mode = MODE_LINE.exec(line)?.[1] ?? INDEX_LINE.exec(line)?.[1];
  if (mode === undefined || PLAIN_MODES.has(mode)) return undefined;
  return mode === '120000'
    ? 'the change creates a symbolic link'
    : `the change uses file mode ${mode}, which is not a regular file`;
}

function headerProblem(line: string): string | undefined {
  if (line.startsWith('diff --git ')) {
    if (line.length > MAX_HEADER_CHARS) return 'a path in the change is too long';
    return SAME_PATH.test(line) ? undefined : 'the change renames or copies a file';
  }
  if (MOVE_LINE.test(line)) return 'the change renames or copies a file';
  return modeProblem(line);
}

/**
 * Why a patch must not be merged, or undefined when it holds only plain-file
 * changes. A header is only ever read where git writes one, at the start of a
 * line; file content in a patch always starts with a space, `+`, `-` or `\`,
 * and binary data is base85, which has no space in it.
 */
export function patchProblem(patch: string): string | undefined {
  for (const line of patch.split('\n')) {
    const first = line.charAt(0);
    if (first === ' ' || first === '+' || first === '-' || first === '\\') continue;
    const problem = headerProblem(line);
    if (problem !== undefined) return problem;
  }
  return undefined;
}
