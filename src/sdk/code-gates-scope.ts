import { existsSync } from 'node:fs';
import path from 'node:path';

import { dirtyEntries } from './write-scope-git';

/**
 * The files changed since the last commit plus untracked ones, relative to the
 * workspace, from `git status` run by the hardened, hook-free git helper the
 * write scope uses. Ignored files never appear; paths outside the workspace are
 * dropped. A workspace that is not a repository has no answer, and says so.
 */
export function changedFiles(workspace: string): { files: readonly string[]; problem?: string } {
  const entries = dirtyEntries(workspace);
  if (entries === undefined) return { files: [], problem: 'the workspace is not a git repository' };
  const unique = new Set(
    entries
      .map((entry) => entry.path.split(path.sep).join('/'))
      .filter((file) => !file.startsWith('../')),
  );
  const files = [...unique].filter((file) => existsSync(path.join(workspace, file))).sort();
  return { files };
}
