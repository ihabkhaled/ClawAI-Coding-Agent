import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import { relativeDir } from './code-gates-detect';
import { GATE_MAX_FILES } from './code-gates.constants';

/**
 * Whether a file name could be read by a gate tool as an option. Checked on the
 * NORMALISED path too: `a/../--fix` starts with a letter as written and becomes
 * `--fix` once the `..` is resolved, which would otherwise reach the tool as a flag.
 */
export function looksLikeFlag(file: string): boolean {
  return file.startsWith('-');
}

/** Workspace-relative files: strings, bounded, never a flag (before or after normalising), inside the workspace. */
export function requestedFiles(value: unknown, root: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > GATE_MAX_FILES) {
    throw new Error(`"files" is an array of at most ${String(GATE_MAX_FILES)} paths.`);
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string' || entry.length === 0 || looksLikeFlag(entry)) {
      throw new Error('Every file is a path string that does not start with "-".');
    }
    const normal = relativeDir(root, containedPath(root, entry));
    if (looksLikeFlag(normal)) {
      throw new Error('Every file is a path string that does not start with "-".');
    }
    return normal;
  });
}

/** The files as the project folder sees them; one that would read as a flag gets a `./` in front. */
export function projectFiles(
  root: string,
  dir: string,
  files: readonly string[],
): readonly string[] {
  const base = path.resolve(root, dir);
  return files.map((file) => {
    const relative = path.relative(base, path.resolve(root, file)).split(path.sep).join('/');
    if (relative.startsWith('..')) throw new Error(`${file} is outside the folder ${dir}.`);
    return looksLikeFlag(relative) ? `./${relative}` : relative;
  });
}

/**
 * Test files read out of a runner's OWN output, kept only when they are plain
 * relative paths. The output is whatever the project's code printed, so a line
 * such as `FAIL --update` must never become an argument of the re-run.
 */
export function plainRelativeFiles(files: readonly string[]): readonly string[] {
  return files.filter(
    (file) =>
      file.length > 0 &&
      file.length <= 500 &&
      !looksLikeFlag(file) &&
      !path.isAbsolute(file) &&
      // A Windows drive or UNC path is absolute on every platform: path.isAbsolute only knows its own.
      !/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(file) &&
      !/[\0\r\n]/u.test(file) &&
      !file.replaceAll('\\', '/').split('/').includes('..'),
  );
}
