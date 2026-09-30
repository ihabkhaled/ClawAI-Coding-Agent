import { spawnSync } from 'node:child_process';
import { lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import {
  WRITE_SCOPE_GIT_MAX_BUFFER,
  WRITE_SCOPE_GIT_TIMEOUT_MS,
  WRITE_SCOPE_MAX_REVERTS,
} from './write-scope.constants';

import type { DirtyEntry, RevertReport } from './write-scope.types';

interface GitOutput {
  readonly ok: boolean;
  readonly stdout: string;
}

/** Runs hardened, hook-free git in `workspace`; a git that cannot run is `ok: false`. */
function runGit(workspace: string, args: readonly string[]): GitOutput {
  try {
    const prepared = prepareGitSpawn('git', args, workspace, inheritedEnvironment(env));
    const finished = spawnSync('git', prepared.arguments, {
      cwd: workspace,
      encoding: 'utf8',
      timeout: WRITE_SCOPE_GIT_TIMEOUT_MS,
      maxBuffer: WRITE_SCOPE_GIT_MAX_BUFFER,
      shell: false,
      windowsHide: true,
      env: { ...prepared.environment, GIT_LITERAL_PATHSPECS: '1' },
    });
    const stdout = typeof finished.stdout === 'string' ? finished.stdout : '';
    return { ok: finished.status === 0, stdout };
  } catch {
    return { ok: false, stdout: '' };
  }
}

/** The workspace's path inside its repository (`''` at the root, `sub/` below it), or undefined outside one. */
function repositoryPrefix(workspace: string): string | undefined {
  const result = runGit(workspace, ['rev-parse', '--show-prefix']);
  return result.ok ? result.stdout.trim() : undefined;
}

/** A repository-relative path as a workspace-relative one; `../x` marks a path outside the workspace. */
function fromRepository(repositoryPath: string, prefix: string): string {
  return repositoryPath.startsWith(prefix)
    ? repositoryPath.slice(prefix.length)
    : `../${repositoryPath}`;
}

function entriesFor(code: string, name: string, original: string | undefined): DirtyEntry[] {
  if (code === '??') return [{ path: name, kind: 'untracked' }];
  const renamed = code.includes('R') || code.includes('C');
  const added: DirtyEntry = {
    path: name,
    kind: code.startsWith('A') || renamed ? 'added' : 'tracked',
  };
  const left: DirtyEntry[] =
    code.includes('R') && original !== undefined ? [{ path: original, kind: 'tracked' }] : [];
  return [added, ...left];
}

/** Parses `git status --porcelain=v1 -z`; a rename yields the new path and the path it left. */
export function parsePorcelain(text: string, prefix: string): DirtyEntry[] {
  const tokens = text.split('\0');
  const entries: DirtyEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token.length < 4) continue;
    const code = token.slice(0, 2);
    const renamed = code.includes('R') || code.includes('C');
    const original = renamed ? tokens[index + 1] : undefined;
    if (renamed) index += 1;
    const name = fromRepository(token.slice(3), prefix);
    const left = original === undefined ? undefined : fromRepository(original, prefix);
    entries.push(...entriesFor(code, name, left));
  }
  return entries;
}

/**
 * Every path git reports as changed or new (ignored files never appear), or
 * undefined when the workspace is not in a repository and nothing can be said.
 */
export function dirtyEntries(workspace: string): DirtyEntry[] | undefined {
  const prefix = repositoryPrefix(workspace);
  if (prefix === undefined) return undefined;
  const status = runGit(workspace, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  return status.ok ? parsePorcelain(status.stdout, prefix) : undefined;
}

/** The staged paths, renames counted as two, or undefined when git cannot say. */
export function stagedPaths(workspace: string): string[] | undefined {
  const prefix = repositoryPrefix(workspace);
  if (prefix === undefined) return undefined;
  const staged = runGit(workspace, ['diff', '--cached', '--name-only', '--no-renames', '-z']);
  if (!staged.ok) return undefined;
  return staged.stdout
    .split('\0')
    .filter((name) => name.length > 0)
    .map((name) => fromRepository(name, prefix));
}

function removeFile(workspace: string, relative: string): boolean {
  const target = path.resolve(workspace, relative);
  try {
    const stats = lstatSync(target, { throwIfNoEntry: false });
    if (stats === undefined) return true;
    if (!stats.isFile() && !stats.isSymbolicLink()) return false;
    unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

function revertOne(workspace: string, entry: DirtyEntry): boolean {
  if (entry.kind === 'untracked') return removeFile(workspace, entry.path);
  if (entry.kind === 'added') {
    const unstaged = runGit(workspace, ['rm', '--force', '--cached', '--quiet', '--', entry.path]);
    return unstaged.ok && removeFile(workspace, entry.path);
  }
  const restore = ['restore', '--source=HEAD', '--staged', '--worktree', '--', entry.path];
  return runGit(workspace, restore).ok;
}

/** Undoes `entries` (at most `WRITE_SCOPE_MAX_REVERTS`), and says what it did and what it left. */
export function revertEntries(workspace: string, entries: readonly DirtyEntry[]): RevertReport {
  const reverted: string[] = [];
  const failed: string[] = [];
  for (const entry of entries.slice(0, WRITE_SCOPE_MAX_REVERTS)) {
    (revertOne(workspace, entry) ? reverted : failed).push(entry.path);
  }
  return { reverted, failed, skipped: Math.max(entries.length - WRITE_SCOPE_MAX_REVERTS, 0) };
}
