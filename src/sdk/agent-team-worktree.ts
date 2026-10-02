import { spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import { patchProblem } from './agent-team-patch';
import {
  TEAM_GIT_MAX_BUFFER,
  TEAM_GIT_TIMEOUT_MS,
  TEAM_WORKTREE_DIRECTORY,
} from './agent-team-tool.constants';

import type { TeamMergeReport, TeamWorktree } from './agent-team-tool.types';

/** Files and folders a child may leave behind that are never part of its work. */
const EXCLUDED = [':(exclude)**/node_modules/**', ':(exclude)node_modules'];

/**
 * How the patch is written, whatever the user's git configuration says: no rename or copy detection
 * (a rename would delete a path the scope check never saw), fixed prefixes, no external diff or text filters.
 */
const PATCH_FLAGS = [
  '--binary',
  '--no-color',
  '--no-renames',
  '--no-ext-diff',
  '--no-textconv',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

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
  sweepStaleWorktrees(base.stateDirectory, base.runKey, repo);
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
  const names = git(worktree.directory, [
    'diff',
    '--cached',
    '--no-renames',
    '--name-only',
    '-z',
    'HEAD',
  ]);
  const diff = git(worktree.directory, ['diff', '--cached', ...PATCH_FLAGS, 'HEAD']);
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
  const unsafe = patchProblem(changes.patch);
  if (unsafe !== undefined) {
    return {
      merged: false,
      files: changes.files.map((file) => file.slice(inside.length)),
      problem: `Not merged: ${unsafe}. Only plain file changes are taken back from a child.`,
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

/** A checkout left by a run that died without cleaning up is forgotten after this long. */
const STALE_WORKTREE_MS = 3 * 24 * 60 * 60 * 1_000;

/**
 * Removes the checkouts of earlier runs that never got to clean up (the process
 * was killed): their folders under the state directory and their registration
 * in the repository. Conflict patches kept for the person are not touched, and
 * neither is the current run. Never throws.
 */
export function sweepStaleWorktrees(
  stateDirectory: string,
  currentRun: string,
  repo: string,
  now = Date.now(),
): void {
  try {
    const root = path.join(stateDirectory, TEAM_WORKTREE_DIRECTORY);
    for (const run of readdirSync(root, { withFileTypes: true })) {
      if (!run.isDirectory() || run.name === currentRun) continue;
      for (const entry of readdirSync(path.join(root, run.name), { withFileTypes: true })) {
        const directory = path.join(root, run.name, entry.name);
        if (!entry.isDirectory() || now - statSync(directory).mtimeMs < STALE_WORKTREE_MS) continue;
        removeWorktree({ repo, directory, prefix: '', workspace: directory });
      }
    }
  } catch {
    // A state directory that cannot be read has nothing to sweep.
  }
}
