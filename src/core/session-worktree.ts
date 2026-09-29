import type { SessionWorktree } from './session-worktree.types';

const WORKTREE_FOLDER = '.clawai/worktrees';
const MAX_SLUG_LENGTH = 40;

/** A branch name reduced to what is safe as a folder and a root key. */
export function worktreeSlug(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/gu, '');
  return slug.length === 0 ? 'session' : slug;
}

/** Where a session worktree goes and what it is addressed by. Never an advertised workspace key. */
export function planSessionWorktree(branch: string): Pick<SessionWorktree, 'path' | 'rootKey'> {
  const slug = worktreeSlug(branch);
  return { rootKey: `session-worktree-${slug}`, path: `${WORKTREE_FOLDER}/${slug}` };
}

/**
 * Whether a `git status --porcelain=v2 --branch` listing shows work that
 * removing the worktree would destroy.
 *
 * The header lines start with `#`; anything else is a changed, renamed,
 * unmerged or untracked path. Removal is forced (the git service has to force
 * it or a worktree with a build folder could never be removed), so this check
 * is the only thing standing between "exit" and lost edits.
 */
export function hasUncommittedChanges(statusOutput: string): boolean {
  return statusOutput.split(/\r?\n/u).some((line) => line.length > 0 && !line.startsWith('#'));
}
