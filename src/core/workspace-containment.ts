import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves a path and proves it is really inside the workspace.
 *
 * Comparing resolved strings is not enough. `path.resolve` collapses `..`, but
 * it knows nothing about symbolic links, so a link inside the workspace that
 * points at the home directory passes a prefix check and then reads or writes
 * wherever it points. An agent that can create files can create that link, and
 * a headless run has nobody watching to notice.
 *
 * So containment is decided on real paths. For a target that does not exist
 * yet — the ordinary case when writing — the nearest existing ancestor is
 * resolved instead, because that is the directory the write will actually land
 * in.
 *
 * A target that exists and is itself a symbolic link is refused outright rather
 * than followed. Writing through a link is how a file inside the workspace
 * becomes a write outside it.
 */
export function containedPath(workspace: string, relative: string): string {
  const root = realpathSync(workspace);
  const target = path.resolve(root, relative);
  const existing = lstatSafe(target);
  if (existing?.isSymbolicLink() === true) {
    throw new Error('Path is a symbolic link, which is not followed');
  }
  const resolved = existing === undefined ? nearestReal(target) : realpathSync(target);
  if (!isInside(root, resolved)) throw new Error('Path escapes the workspace');
  return target;
}

/**
 * The real path of the closest ancestor that exists.
 *
 * Walking up rather than giving up: a write to `a/b/c.txt` in a workspace whose
 * `a` is a link out of the workspace must be refused, and the only way to see
 * that is to resolve the part that is already there.
 */
function nearestReal(target: string): string {
  let candidate = path.dirname(target);
  for (;;) {
    const stats = lstatSafe(candidate);
    if (stats !== undefined) return realpathSync(candidate);
    const parent = path.dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function lstatSafe(target: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(target);
  } catch {
    return undefined;
  }
}
