import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  WRITE_SCOPE_GIT_GUARDED_DIRECTORIES,
  WRITE_SCOPE_GIT_GUARDED_FILES,
  WRITE_SCOPE_GUARD_MAX_BYTES,
  WRITE_SCOPE_GUARD_MAX_FILES,
  WRITE_SCOPE_MAX_REPORTED,
  WRITE_SCOPE_NOTE_CHARS,
  WRITE_SCOPE_PARENT_MAX_ENTRIES,
} from './write-scope.constants';

import type {
  GuardedFile,
  GuardReport,
  ParentEntry,
  WriteScope,
  WriteScopeGuard,
} from './write-scope.types';

/** The nearest `.git` directory at or above `workspace`, or undefined (a `.git` file is a worktree link, not followed). */
function findGitDirectory(workspace: string): string | undefined {
  let current = path.resolve(workspace);
  for (;;) {
    const candidate = path.join(current, '.git');
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      // not here
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function filesBelow(directory: string, found: string[]): void {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of names) {
    if (found.length >= WRITE_SCOPE_GUARD_MAX_FILES) return;
    const full = path.join(directory, name);
    const stats = lstatSync(full, { throwIfNoEntry: false });
    if (stats === undefined) continue;
    if (stats.isDirectory()) filesBelow(full, found);
    else found.push(full);
  }
}

function signatureOf(size: number, mtimeMs: number): string {
  return `${String(size)}:${String(mtimeMs)}`;
}

function snapshotFile(file: string): GuardedFile | undefined {
  const stats = lstatSync(file, { throwIfNoEntry: false });
  if (stats === undefined || stats.isDirectory()) return undefined;
  const small = stats.isFile() && stats.size <= WRITE_SCOPE_GUARD_MAX_BYTES;
  const content = small ? readFileSync(file) : undefined;
  return { content, signature: signatureOf(stats.size, stats.mtimeMs) };
}

function gitSnapshot(gitDirectory: string): Map<string, GuardedFile> {
  const files: string[] = WRITE_SCOPE_GIT_GUARDED_FILES.map((name) =>
    path.join(gitDirectory, name),
  );
  for (const name of WRITE_SCOPE_GIT_GUARDED_DIRECTORIES) {
    filesBelow(path.join(gitDirectory, name), files);
  }
  const taken = new Map<string, GuardedFile>();
  for (const file of files) {
    const entry = snapshotFile(file);
    if (entry !== undefined) taken.set(file, entry);
  }
  return taken;
}

function changed(before: GuardedFile | undefined, after: GuardedFile | undefined): boolean {
  if (before === undefined || after === undefined) return before !== after;
  if (before.content !== undefined && after.content !== undefined) {
    return !before.content.equals(after.content);
  }
  return before.signature !== after.signature;
}

/** Puts `file` back as it was: rewritten, or removed when it did not exist. False when it cannot be. */
function restore(file: string, before: GuardedFile | undefined): boolean {
  try {
    if (before === undefined) unlinkSync(file);
    else if (before.content === undefined) return false;
    else writeFileSync(file, before.content);
    return true;
  } catch {
    return false;
  }
}

function verifyGit(
  gitDirectory: string,
  before: ReadonlyMap<string, GuardedFile>,
  label: (file: string) => string,
): GuardReport {
  const after = gitSnapshot(gitDirectory);
  const paths: string[] = [];
  const reverted: string[] = [];
  const failed: string[] = [];
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(file);
    if (!changed(was, after.get(file))) continue;
    paths.push(label(file));
    (restore(file, was) ? reverted : failed).push(label(file));
  }
  return { paths, reverted, failed };
}

function parentSnapshot(parent: string): Map<string, ParentEntry> | undefined {
  try {
    const taken = new Map<string, ParentEntry>();
    for (const name of readdirSync(parent).slice(0, WRITE_SCOPE_PARENT_MAX_ENTRIES)) {
      const stats = lstatSync(path.join(parent, name), { throwIfNoEntry: false });
      if (stats !== undefined)
        taken.set(name, { signature: signatureOf(stats.size, stats.mtimeMs) });
    }
    return taken;
  } catch {
    return undefined;
  }
}

function removeNew(target: string): boolean {
  try {
    rmSync(target, { recursive: true, force: true });
    return !existsSync(target);
  } catch {
    return false;
  }
}

function verifyParent(
  parent: string,
  workspaceName: string,
  before: ReadonlyMap<string, ParentEntry>,
): GuardReport {
  const after = parentSnapshot(parent);
  const paths: string[] = [];
  const reverted: string[] = [];
  const failed: string[] = [];
  for (const [name, entry] of after ?? []) {
    const was = before.get(name);
    if (name === workspaceName || name === '.git' || was?.signature === entry.signature) continue;
    const shown = `../${name}`;
    paths.push(shown);
    // only an entry that did not exist is deleted; a rewrite of an existing one is reported
    (was === undefined && removeNew(path.join(parent, name)) ? reverted : failed).push(shown);
  }
  return { paths, reverted, failed };
}

function merge(reports: readonly (GuardReport | undefined)[]): GuardReport {
  const present = reports.filter((report): report is GuardReport => report !== undefined);
  return {
    paths: present.flatMap((report) => report.paths),
    reverted: present.flatMap((report) => report.reverted),
    failed: present.flatMap((report) => report.failed),
  };
}

/**
 * Snapshots what a command can change without git noticing: the hooks, config,
 * exclude and attributes under `.git`, and the entries beside the workspace.
 * `verify` reverts what it can (rewrites those `.git` files, deletes entries
 * that did not exist) and lists everything that moved. Best effort: commands
 * are not sandboxed, and a rewrite of an existing outside file is reported,
 * not undone.
 */
export function captureWriteGuard(workspace: string): WriteScopeGuard {
  const root = path.resolve(workspace);
  const gitDirectory = findGitDirectory(root);
  const gitBefore = gitDirectory === undefined ? undefined : gitSnapshot(gitDirectory);
  const parent = path.dirname(root);
  const parentBefore = parent === root ? undefined : parentSnapshot(parent);
  const label = (file: string): string => path.relative(root, file).split(path.sep).join('/');
  return {
    verify: () =>
      merge([
        gitDirectory === undefined || gitBefore === undefined
          ? undefined
          : verifyGit(gitDirectory, gitBefore, label),
        parentBefore === undefined
          ? undefined
          : verifyParent(parent, path.basename(root), parentBefore),
      ]),
  };
}

/** Verifies the guard; a change is undone, emitted as write-scope.violation, and fails the call. */
export function enforceGuard(guard: WriteScopeGuard, scope: WriteScope, tool: string): void {
  const report = guard.verify();
  if (report.paths.length === 0) return;
  scope.onViolation?.({ tool, paths: report.paths.slice(0, WRITE_SCOPE_MAX_REPORTED) });
  const parts = [
    `Write scope: ${tool} changed .git hooks/config or entries outside the workspace: ${report.paths.join(', ')}.`,
  ];
  if (report.reverted.length > 0) parts.push(`Reverted: ${report.reverted.join(', ')}.`);
  if (report.failed.length > 0) {
    parts.push(`Could not revert (undo by hand): ${report.failed.join(', ')}.`);
  }
  throw new Error(parts.join(' ').slice(0, WRITE_SCOPE_NOTE_CHARS));
}
