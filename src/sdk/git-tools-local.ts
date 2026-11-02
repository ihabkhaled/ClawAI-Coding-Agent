import { branchName, revision } from './git-tools-args';
import { conflictedFiles } from './git-tools-remote';
import { outcome, runGit } from './git-tools-run';
import {
  GIT_MAX_HEADER_CHARS,
  GIT_QUICK_TIMEOUT_MS,
  GIT_SLOW_TIMEOUT_MS,
} from './git-tools.constants';

import type { GitToolContext } from './git-tools.types';

type ToolResult = Record<string, unknown>;

/** Index/worktree status codes of a path that still has an unresolved merge conflict. */
const UNMERGED_STATUS = /^(?:DD|AU|UD|UA|DU|AA|UU) /u;

const QUICK = { write: true, timeoutMs: GIT_QUICK_TIMEOUT_MS } as const;

/**
 * `git merge` of one local branch into the current one. A conflict is an
 * answer, not a crash: the merge is aborted so the tree is clean again, and
 * the conflicted files are listed so the model can decide what to do next.
 */
export async function mergeOperation(context: GitToolContext): Promise<ToolResult> {
  const name = branchName('merge', context.args.branch);
  const result = await runGit(context, ['merge', '--no-edit', name], {
    write: true,
    timeoutMs: GIT_SLOW_TIMEOUT_MS,
  });
  if (result.exitCode === 0) return outcome(result, { branch: name, conflicts: [] });
  const conflicts = await conflictedFiles(context);
  if (conflicts.length === 0) return outcome(result, { branch: name, conflicts });
  const abort = await runGit(context, ['merge', '--abort'], QUICK);
  return outcome(result, { branch: name, conflicts, mergeAborted: abort.exitCode === 0 });
}

/**
 * `git rebase` onto one local branch. Never interactive, never autostashing.
 * It rewrites local commits only: push is never forced, so a rewritten branch
 * that was already pushed cannot be published by this tool.
 */
export async function rebaseOperation(context: GitToolContext): Promise<ToolResult> {
  const name = branchName('rebase', context.args.branch);
  const result = await runGit(context, ['rebase', '--no-autostash', name], {
    write: true,
    timeoutMs: GIT_SLOW_TIMEOUT_MS,
  });
  if (result.exitCode === 0) return outcome(result, { branch: name, conflicts: [] });
  const conflicts = await conflictedFiles(context);
  if (conflicts.length === 0) return outcome(result, { branch: name, conflicts });
  const abort = await runGit(context, ['rebase', '--abort'], QUICK);
  return outcome(result, { branch: name, conflicts, rebaseAborted: abort.exitCode === 0 });
}

/**
 * `push` shelves tracked changes AND untracked files (never ignored ones),
 * `pop` brings the newest back, `list` shows what is shelved. Nothing here
 * drops or clears a stash.
 */
export async function stashOperation(context: GitToolContext): Promise<ToolResult> {
  const action = context.args.action;
  if (action === 'list') return outcome(await runGit(context, ['stash', 'list'], QUICK));
  if (action === 'push') return stashPush(context);
  if (action === 'pop') return stashPop(context);
  throw new Error('workspace.git stash: "action" is push, pop or list.');
}

/** Status entries of the tree: `XY path`, untracked files listed one by one. */
async function treeEntries(context: GitToolContext): Promise<readonly string[]> {
  const status = await runGit(
    context,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    { ...QUICK, write: false },
  );
  return status.stdout.split('\0').filter((entry) => entry.length > 3);
}

/**
 * Shelves the tree, untracked files included, and proves the untracked files
 * landed in the stash (its third parent) before saying so. A tree git cannot
 * restore (unresolved conflicts) is refused up front; if the proof fails the
 * stash is applied back, never dropped, and the answer says so.
 */
async function stashPush(context: GitToolContext): Promise<ToolResult> {
  const note = oneLine('stash', context.args.message);
  const entries = await treeEntries(context);
  if (entries.some((entry) => UNMERGED_STATUS.test(entry))) {
    throw new Error(
      'workspace.git stash push: the tree has unresolved conflicts; resolve them first.',
    );
  }
  const untracked = entries
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3));
  const before = await stashTip(context);
  const result = await runGit(
    context,
    ['stash', 'push', '--include-untracked', ...(note === undefined ? [] : ['--message', note])],
    { ...QUICK, literalPathspecs: false },
  );
  const tip = await stashTip(context);
  if (result.exitCode !== 0 || tip === before) return outcome(result, { stashed: false });
  const kept = await stashedUntracked(context);
  if (untracked.every((file) => kept.has(file))) {
    return outcome(result, { stashed: true, untracked: untracked.length });
  }
  const restore = await runGit(context, ['stash', 'apply', '--index'], QUICK);
  return outcome(result, {
    stashed: false,
    stashKept: true,
    restored: restore.exitCode === 0,
    problem: 'Untracked files were not found in the stash; the stash was applied back and kept.',
  });
}

/** The commit `refs/stash` points at, or undefined when nothing is stashed. */
async function stashTip(context: GitToolContext): Promise<string | undefined> {
  const tip = await runGit(context, ['rev-parse', '--verify', '--quiet', 'refs/stash'], {
    ...QUICK,
    write: false,
  });
  return tip.exitCode === 0 ? tip.stdout.trim() : undefined;
}

/** The files the newest stash holds as untracked (its third parent). */
async function stashedUntracked(context: GitToolContext): Promise<ReadonlySet<string>> {
  const listed = await runGit(context, ['ls-tree', '-r', '--name-only', '-z', 'refs/stash^3'], {
    ...QUICK,
    write: false,
  });
  return new Set(
    listed.exitCode === 0 ? listed.stdout.split('\0').filter((f) => f.length > 0) : [],
  );
}

function oneLine(operation: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > GIT_MAX_HEADER_CHARS || /[\r\n\0]/u.test(value)) {
    throw new Error(
      `workspace.git ${operation}: "message" is one line of at most ${String(GIT_MAX_HEADER_CHARS)} characters.`,
    );
  }
  return value.trim().length === 0 ? undefined : value.trim();
}

/**
 * Pops only onto a clean tree, so a conflict can never tangle with work that
 * was not shelved. A conflict resets the attempt (`reset --merge`) and leaves
 * the stash in place, which is what git does for a failed pop anyway.
 */
async function stashPop(context: GitToolContext): Promise<ToolResult> {
  const dirty = await runGit(context, ['status', '--porcelain'], { ...QUICK, write: false });
  if (dirty.stdout.trim().length > 0) {
    throw new Error(
      'workspace.git stash pop: the tree has uncommitted changes; commit or stash them first.',
    );
  }
  const result = await runGit(context, ['stash', 'pop'], QUICK);
  if (result.exitCode === 0) return outcome(result, { conflicts: [] });
  const conflicts = await conflictedFiles(context);
  if (conflicts.length === 0) return outcome(result, { conflicts });
  const reset = await runGit(context, ['reset', '--merge'], QUICK);
  return outcome(result, { conflicts, popReverted: reset.exitCode === 0, stashKept: true });
}

/**
 * Lists tags, or creates one annotated tag locally on HEAD or a given ref.
 * Never replaces, deletes or publishes a tag: push sends one branch and no tags.
 */
export async function tagOperation(context: GitToolContext): Promise<ToolResult> {
  const requested = context.args.name;
  if (requested === undefined) {
    return outcome(await runGit(context, ['tag', '--list', '--sort=-creatordate'], QUICK));
  }
  const name = branchName('tag', requested);
  const check = await runGit(context, ['check-ref-format', `refs/tags/${name}`], {
    ...QUICK,
    write: false,
  });
  if (check.exitCode !== 0)
    throw new Error(`workspace.git tag: "${name}" is not a valid tag name.`);
  const note = oneLine('tag', context.args.message) ?? name;
  const target = revision(context.args.ref);
  const result = await runGit(context, ['tag', '-a', name, '-m', note, target], QUICK);
  return outcome(result, { tag: name, created: result.exitCode === 0 });
}
