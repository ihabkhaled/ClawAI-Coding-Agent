import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isPathInside } from '../core/path-inside';

import {
  branchName,
  commitMessage,
  formatCommitMessage,
  timeoutMilliseconds,
} from './git-tools-args';
import { currentBranch, outcome, runGit } from './git-tools-run';
import {
  GIT_MAX_CONFLICTS,
  GIT_MESSAGE_DIRECTORY_PREFIX,
  GIT_PUSH_CONFIG,
  GIT_QUICK_TIMEOUT_MS,
  GIT_REMOTE_NAME,
  GIT_SLOW_TIMEOUT_MS,
} from './git-tools.constants';

import type { GitToolContext } from './git-tools.types';

type ToolResult = Record<string, unknown>;

/**
 * Commits what is staged, running the repository's hooks normally.
 *
 * The argument list is fixed: nothing the model wrote can become a flag, so
 * `--no-verify` and `--no-gpg-sign` cannot be asked for. The message goes
 * through a file outside the workspace so it is never parsed as an option.
 */
export async function commitOperation(context: GitToolContext): Promise<ToolResult> {
  const text = formatCommitMessage(commitMessage(context.args));
  const directory = messageDirectory(context.workspace);
  try {
    const file = path.join(directory, 'message.txt');
    writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
    const result = await runGit(context, ['commit', '-F', file], {
      write: true,
      timeoutMs: timeoutMilliseconds(context.args, GIT_SLOW_TIMEOUT_MS),
    });
    if (result.exitCode !== 0) {
      return outcome(result, {
        committed: false,
        failure:
          `The commit did not happen: git exited ${String(result.exitCode)}. A pre-commit or commit-msg hook ` +
          'may have refused it: read stderr, fix the cause, stage again and retry. Never bypass the hook.',
      });
    }
    const hash = await headHash(context);
    return outcome(result, { committed: true, ...(hash === undefined ? {} : { hash }) });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function messageDirectory(workspace: string): string {
  const temporary = os.tmpdir();
  if (isPathInside(path.resolve(workspace), path.resolve(temporary))) {
    throw new Error('workspace.git commit: the temp directory is inside the workspace.');
  }
  return mkdtempSync(path.join(temporary, GIT_MESSAGE_DIRECTORY_PREFIX));
}

async function headHash(context: GitToolContext): Promise<string | undefined> {
  const result = await runGit(context, ['rev-parse', 'HEAD'], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  const hash = result.stdout.trim();
  return result.exitCode === 0 && /^[0-9a-f]{40,64}$/u.test(hash) ? hash : undefined;
}

/** Fetches `origin`. No tags, no pruning, nothing from the model in the argument list. */
export async function fetchOperation(context: GitToolContext): Promise<ToolResult> {
  const result = await runGit(context, ['fetch', '--no-tags', GIT_REMOTE_NAME], {
    write: true,
    credentials: true,
    timeoutMs: timeoutMilliseconds(context.args, GIT_SLOW_TIMEOUT_MS),
  });
  return outcome(result);
}

/**
 * `git pull --rebase`, never autostashing. A conflict is an answer, not a
 * crash: the rebase is aborted so the tree is clean again, and the conflicted
 * files are listed so the model can decide what to do next.
 */
export async function pullOperation(context: GitToolContext): Promise<ToolResult> {
  const result = await runGit(context, ['pull', '--rebase', '--no-autostash'], {
    write: true,
    credentials: true,
    timeoutMs: timeoutMilliseconds(context.args, GIT_SLOW_TIMEOUT_MS),
  });
  if (result.exitCode === 0) return outcome(result, { conflicts: [] });
  const conflicts = await conflictedFiles(context);
  if (conflicts.length === 0) return outcome(result, { conflicts });
  const abort = await runGit(context, ['rebase', '--abort'], {
    write: true,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  return outcome(result, { conflicts, rebaseAborted: abort.exitCode === 0 });
}

async function conflictedFiles(context: GitToolContext): Promise<string[]> {
  const result = await runGit(context, ['diff', '--name-only', '--diff-filter=U'], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  return result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .slice(0, GIT_MAX_CONFLICTS)
    .map((line) => line.slice(0, 300));
}

/**
 * Pushes HEAD to `origin` as one named branch.
 *
 * The refspec is built here, from a validated branch name, as
 * `HEAD:refs/heads/<branch>`. There is no flag the model can add, so no force,
 * no deletion, no mirror and no tags. A pre-push hook can run for minutes, so
 * the default wait is 30 minutes; the process tree is killed on abort.
 */
export async function pushOperation(context: GitToolContext): Promise<ToolResult> {
  const explicit = context.args.branch !== undefined;
  const branch = explicit ? branchName('push', context.args.branch) : await headBranch(context);
  const check = await runGit(context, ['check-ref-format', `refs/heads/${branch}`], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  if (check.exitCode !== 0)
    throw new Error(`workspace.git push: "${branch}" is not a valid branch name.`);
  const upstream = explicit ? [] : ['--set-upstream'];
  const result = await runGit(
    context,
    ['push', ...upstream, GIT_REMOTE_NAME, `HEAD:refs/heads/${branch}`],
    {
      write: true,
      credentials: true,
      config: GIT_PUSH_CONFIG,
      timeoutMs: timeoutMilliseconds(context.args, GIT_SLOW_TIMEOUT_MS),
    },
  );
  const rejected = /\[rejected\]|non-fast-forward|fetch first/iu.test(result.stderr);
  return outcome(result, { branch, pushed: result.exitCode === 0, rejected });
}

async function headBranch(context: GitToolContext): Promise<string> {
  const branch = await currentBranch(context);
  if (branch === undefined) {
    throw new Error('workspace.git push: HEAD is detached; name a "branch" to push to.');
  }
  return branch;
}
