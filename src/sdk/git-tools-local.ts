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
 * `push` shelves tracked changes (untracked files stay: git's cleanup of them
 * does not work under the literal pathspecs every call here runs with), `pop` brings the newest back, `list` shows what is shelved. */
export async function stashOperation(context: GitToolContext): Promise<ToolResult> {
  const action = context.args.action;
  if (action === 'list') return outcome(await runGit(context, ['stash', 'list'], QUICK));
  if (action === 'push') return stashPush(context);
  if (action === 'pop') return stashPop(context);
  throw new Error('workspace.git stash: "action" is push, pop or list.');
}

async function stashPush(context: GitToolContext): Promise<ToolResult> {
  const note = oneLine('stash', context.args.message);
  const result = await runGit(
    context,
    ['stash', 'push', ...(note === undefined ? [] : ['--message', note])],
    QUICK,
  );
  return outcome(result);
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
