import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import {
  TEAM_GIT_MAX_BUFFER,
  TEAM_GIT_TIMEOUT_MS,
  TEAM_WORKTREE_DIRECTORY,
} from './agent-team-tool.constants';

import type { TeamMergeReport, TeamWorktree } from './agent-team-tool.types';

/** Files and folders a child may leave behind that are never part of its work. */
const EXCLUDED = [':(exclude)**/node_modules/**', ':(exclude)node_modules'];

/** The most bytes of change one child may hand back. */
const PATCH_MAX_BYTES = 16 * 1024 * 1024;

/** How deep and how wide the clean-up looks for links before it removes a directory. */
const LINK_WALK_LIMIT = 20_000;

interface GitOutcome {
  readonly ok: boolean;
  readonly out: string;
  readonly err: string;
}

function git(cwd: string, args: readonly string[]): GitOutcome {
  try {
    const prepared = prepareGitSpawn('git', args, cwd, inheritedEnvironment(env));
    const finished = spawnSync('git', prepared.arguments, {
      cwd,
      encoding: 'utf8',
      timeout: TEAM_GIT_TIMEOUT_MS,
      maxBuffer: TEAM_GIT_MAX_BUFFER,
      shell: false,
      env: prepared.environment,
    });
    return {
      ok: finished.status === 0,
      out: typeof finished.stdout === 'string' ? finished.stdout : '',
      err: typeof finished.stderr === 'string' ? finished.stderr.trim() : '',
    };
  } catch (error) {
    return { ok: false, out: '', err: error instanceof Error ? error.message : 'git failed' };
  }
}

/**
 * A detached checkout of HEAD for one child, under the state directory.
 *
 * What the workspace has uncommitted is not in it: the child starts from the
 * last commit. Returns the reason instead when there is no repository, no
 * commit, or git refuses.
 */
export function createWorktree(
  workspace: string,
  base: { readonly stateDirectory: string; readonly runKey: string; readonly name: string },
): TeamWorktree | string {
  const top = git(workspace, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    return 'isolation "worktree" needs the workspace to be inside a git repository.';
  }
  if (!git(workspace, ['rev-parse', '--verify', 'HEAD']).ok) {
    return 'isolation "worktree" needs at least one commit in the repository.';
  }
  const repo = path.resolve(top.out.trim());
  const prefix = git(workspace, ['rev-parse', '--show-prefix']).out.trim().replace(/\/$/u, '');
  const directory = path.join(base.stateDirectory, TEAM_WORKTREE_DIRECTORY, base.runKey, base.name);
  mkdirSync(path.dirname(directory), { recursive: true });
  const added = git(repo, ['worktree', 'add', '--detach', directory, 'HEAD']);
  if (!added.ok) return `Could not create the worktree: ${added.err.slice(0, 300)}`;
  return {
    repo,
    directory,
    prefix,
    workspace: prefix.length === 0 ? directory : path.join(directory, ...prefix.split('/')),
  };
}

/** What a child changed in its worktree, as a patch and the repository-relative paths in it. */
export function collectChanges(worktree: TeamWorktree): {
  readonly patch: string;
  readonly files: readonly string[];
  readonly problem?: string;
} {
  const staged = git(worktree.directory, ['add', '-A', '--', '.', ...EXCLUDED]);
  if (!staged.ok) return { patch: '', files: [], problem: staged.err.slice(0, 300) };
  const names = git(worktree.directory, ['diff', '--cached', '--name-only', '-z', 'HEAD']);
  const diff = git(worktree.directory, ['diff', '--cached', '--binary', '--no-color', 'HEAD']);
  if (!names.ok || !diff.ok) {
    return { patch: '', files: [], problem: (names.err || diff.err).slice(0, 300) };
  }
  const files = names.out.split('\0').filter((name) => name.length > 0);
  return Buffer.byteLength(diff.out, 'utf8') > PATCH_MAX_BYTES
    ? { patch: '', files, problem: 'The change is larger than 16 MiB and was not merged.' }
    : { patch: diff.out, files };
}

/**
 * Takes a child's change back into the workspace, all or nothing.
 *
 * Every path must be inside the workspace and pass `allowed`, the child's own
 * write scope read from the workspace's side, so a worktree cannot carry a
 * change the scope would have refused. `git apply` is atomic: a conflict
 * leaves the workspace as it was and the patch file is kept for the person.
 */
export function mergeChanges(
  worktree: TeamWorktree,
  changes: { readonly patch: string; readonly files: readonly string[] },
  patchFile: string,
  allowed: (workspaceRelative: string) => boolean,
): TeamMergeReport {
  if (changes.files.length === 0) return { merged: true, files: [] };
  const inside = worktree.prefix.length === 0 ? '' : `${worktree.prefix}/`;
  const refused = changes.files.filter(
    (file) => !file.startsWith(inside) || !allowed(file.slice(inside.length)),
  );
  if (refused.length > 0) {
    return {
      merged: false,
      files: changes.files,
      problem: `Not merged: ${refused.slice(0, 5).join(', ')} is outside the child's write scope.`,
    };
  }
  mkdirSync(path.dirname(patchFile), { recursive: true });
  writeFileSync(patchFile, changes.patch);
  const applied = git(worktree.repo, ['apply', '--whitespace=nowarn', patchFile]);
  return applied.ok
    ? { merged: true, files: changes.files.map((file) => file.slice(inside.length)) }
    : {
        merged: false,
        files: changes.files.map((file) => file.slice(inside.length)),
        patchFile,
        problem: `The changes conflict with the workspace and were not applied: ${applied.err.slice(0, 300)}`,
      };
}

/**
 * Unlinks every symbolic link and junction below `directory` without following
 * it, so removing the directory afterwards cannot reach what a link points to.
 */
function unlinkLinks(directory: string): void {
  const queue = [directory];
  let seen = 0;
  while (queue.length > 0 && seen < LINK_WALK_LIMIT) {
    const current = queue.pop() ?? '';
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      seen += 1;
      const full = path.join(current, entry.name);
      if (lstatSync(full).isSymbolicLink()) unlinkSync(full);
      else if (entry.isDirectory()) queue.push(full);
    }
  }
}

/** Removes a worktree and its registration. Never throws; never follows a link out of it. */
export function removeWorktree(worktree: TeamWorktree): void {
  try {
    unlinkLinks(worktree.directory);
  } catch {
    // Whatever could not be unlinked is left for the recursive removal, which does not follow links.
  }
  try {
    rmSync(worktree.directory, { recursive: true, force: true });
  } catch {
    // Left in the state directory; `git worktree prune` below forgets it once it is gone.
  }
  git(worktree.repo, ['worktree', 'prune']);
}
