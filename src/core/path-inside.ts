import path from 'node:path';

type PathApi = typeof path.posix;

/**
 * Whether `candidate` is `root` or below it, for two already-canonical paths.
 *
 * `startsWith(root + sep)` fails for a root that already ends in a separator
 * (`C:\` or `/`), and a plain prefix test accepts `C:\work-evil`. Comparing the
 * relative path handles both, and Windows paths compare without regard to case.
 */
export function isPathInside(root: string, candidate: string, paths: PathApi = path): boolean {
  const windows = paths === path.win32;
  const relative = paths.relative(
    windows ? root.toLowerCase() : root,
    windows ? candidate.toLowerCase() : candidate,
  );
  if (relative === '') return true;
  const escapes = relative === '..' || relative.startsWith(`..${paths.sep}`);
  return !escapes && !paths.isAbsolute(relative);
}
