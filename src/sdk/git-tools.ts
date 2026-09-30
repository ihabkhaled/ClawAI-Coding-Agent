import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import { branchName, explicitPaths, revision } from './git-tools-args';
import { commitOperation, fetchOperation, pullOperation, pushOperation } from './git-tools-remote';
import { redactRemoteUrls, remoteEntries } from './git-tools-remotes-list';
import { currentBranch, outcome, runGit } from './git-tools-run';
import {
  GIT_EXTRA_READ_OPERATIONS,
  GIT_QUICK_TIMEOUT_MS,
  GIT_WRITE_OPERATIONS,
} from './git-tools.constants';

import type { GitToolContext } from './git-tools.types';

type ToolResult = Record<string, unknown>;

/** Whether this module runs `operation` (status, diff and log stay with the executor). */
export function isGitToolOperation(operation: string): boolean {
  return GIT_EXTRA_READ_OPERATIONS.includes(operation) || GIT_WRITE_OPERATIONS.includes(operation);
}

/**
 * Runs one of the operations this module owns. The argument list of each is
 * fixed here; only validated values (paths, a branch, a message) are placed in
 * it, and always behind `--` or as the value of a fixed flag.
 */
export async function executeGitTool(
  operation: string,
  args: Readonly<Record<string, unknown>>,
  workspace: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const context: GitToolContext = { workspace, signal, args };
  const read = await readOperation(operation, context);
  if (read !== undefined) return read;
  const stage = await stagingOperation(operation, context);
  if (stage !== undefined) return stage;
  return remoteOperation(operation, context);
}

async function readOperation(
  operation: string,
  context: GitToolContext,
): Promise<ToolResult | undefined> {
  if (operation === 'show') return showOperation(context);
  if (operation === 'remote') return remoteListOperation(context);
  if (operation === 'branch') return branchListOperation(context);
  return undefined;
}

async function stagingOperation(
  operation: string,
  context: GitToolContext,
): Promise<ToolResult | undefined> {
  if (operation === 'add') return pathOperation('add', ['add', '--'], context);
  if (operation === 'unstage') return pathOperation('unstage', ['reset', '--quiet', '--'], context);
  if (operation === 'restore') {
    return pathOperation('restore', ['restore', '--worktree', '--'], context);
  }
  if (operation === 'switch') return switchOperation(context);
  return undefined;
}

async function remoteOperation(operation: string, context: GitToolContext): Promise<ToolResult> {
  if (operation === 'commit') return commitOperation(context);
  if (operation === 'fetch') return fetchOperation(context);
  if (operation === 'pull') return pullOperation(context);
  if (operation === 'push') return pushOperation(context);
  throw new Error(`workspace.git ${operation} is not available.`);
}

async function showOperation(context: GitToolContext): Promise<ToolResult> {
  const target = revision(context.args.ref);
  const file = context.args.path;
  const tail =
    typeof file === 'string' && file.length > 0
      ? ['--', path.relative(context.workspace, containedPath(context.workspace, file))]
      : [];
  const result = await runGit(
    context,
    ['show', '--no-color', '--stat', '--patch', target, ...tail],
    { write: false, timeoutMs: GIT_QUICK_TIMEOUT_MS },
  );
  return outcome(result);
}

async function remoteListOperation(context: GitToolContext): Promise<ToolResult> {
  const result = await runGit(context, ['remote', '-v'], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  return outcome(
    { ...result, stdout: '', stderr: redactRemoteUrls(result.stderr) },
    { remotes: remoteEntries(result.stdout) },
  );
}

async function branchListOperation(context: GitToolContext): Promise<ToolResult> {
  const result = await runGit(context, ['branch', '--list', '--all', '--no-color', '-vv'], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  const current = await currentBranch(context);
  return outcome(result, current === undefined ? {} : { current });
}

async function pathOperation(
  operation: string,
  gitArguments: readonly string[],
  context: GitToolContext,
): Promise<ToolResult> {
  const paths = explicitPaths(operation, context.args, context.workspace);
  const result = await runGit(context, [...gitArguments, ...paths], {
    write: true,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  return outcome(result, { paths });
}

/** Switches branch, optionally creating it. Never forces, so local changes are never discarded. */
async function switchOperation(context: GitToolContext): Promise<ToolResult> {
  const name = branchName('switch', context.args.branch);
  const create = context.args.create === true;
  const result = await runGit(context, create ? ['switch', '-c', name] : ['switch', name], {
    write: true,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  return outcome(result, { branch: name, created: create && result.exitCode === 0 });
}
