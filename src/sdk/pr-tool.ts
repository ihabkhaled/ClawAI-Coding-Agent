import { mergeBlockers, reviewFlag } from '../core/pull-request-actions';
import {
  PULL_REQUEST_DIFF_CHARS,
  PULL_REQUEST_MERGE_METHODS,
  PULL_REQUEST_REVIEW_BODY_CHARS,
  PULL_REQUEST_REVIEW_EVENTS,
  PULL_REQUEST_UNTRUSTED_NOTICE,
} from '../core/pull-request-actions.constants';
import { redactText } from '../core/redaction';

import { failureDetail, readChecks, readPullRequest, runGh } from './pr-tool-gh';
import { PR_MAX_NUMBER, PR_TOOL_NAME } from './pr-tool.constants';

import type { GhRunner, PrTool, PrToolContext } from './pr-tool.types';
import type {
  PullRequestMergeMethod,
  PullRequestReviewEvent,
} from '../core/pull-request-actions.types';

type Result = Record<string, unknown>;
type Args = Readonly<Record<string, unknown>>;

function pullRequestNumber(args: Args): number {
  const value = args.number;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > PR_MAX_NUMBER) {
    throw new Error(
      `${PR_TOOL_NAME}: "number" is a whole number from 1 to ${String(PR_MAX_NUMBER)}.`,
    );
  }
  return value;
}

function oneOf<T extends string>(name: string, value: unknown, allowed: readonly T[]): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`${PR_TOOL_NAME}: "${name}" is ${allowed.join(', ')}.`);
  return found;
}

function unreadable(number: number): Result {
  return { ok: false, detail: `Pull request #${String(number)} could not be read.` };
}

async function view(run: GhRunner, args: Args, context: PrToolContext): Promise<Result> {
  const number = pullRequestNumber(args);
  const notice = PULL_REQUEST_UNTRUSTED_NOTICE;
  const { workspace, signal } = context;
  const pullRequest = await readPullRequest(run, number, workspace, signal);
  if (pullRequest === undefined) return { ...unreadable(number), viewed: false, notice };
  if (args.diff !== true) return { ok: true, viewed: true, pullRequest, notice };
  const diff = await run(['pr', 'diff', String(number), '--color=never'], workspace, signal);
  const text = diff.exitCode === 0 ? redactText(diff.stdout).slice(0, PULL_REQUEST_DIFF_CHARS) : '';
  return { ok: true, viewed: true, pullRequest, diff: text, notice };
}

function reviewRequest(args: Args): { event: PullRequestReviewEvent; body: string } {
  const event = oneOf('event', args.event, PULL_REQUEST_REVIEW_EVENTS);
  const body = typeof args.body === 'string' ? args.body : '';
  if (body.length > PULL_REQUEST_REVIEW_BODY_CHARS) {
    throw new Error(`${PR_TOOL_NAME}: the review text is too long.`);
  }
  if (event !== 'approve' && body.trim().length === 0) {
    throw new Error(`${PR_TOOL_NAME}: a comment or change request needs "body".`);
  }
  return { event, body };
}

async function review(run: GhRunner, args: Args, context: PrToolContext): Promise<Result> {
  const number = pullRequestNumber(args);
  const { event, body } = reviewRequest(args);
  const { workspace, signal } = context;
  if ((await readPullRequest(run, number, workspace, signal)) === undefined) {
    return { ...unreadable(number), reviewed: false };
  }
  const flags = [reviewFlag(event), ...(body.length === 0 ? [] : ['--body', body])];
  const result = await run(['pr', 'review', String(number), ...flags], workspace, signal);
  if (result.exitCode === 0) return { ok: true, reviewed: true, number, event };
  return { ok: false, reviewed: false, detail: failureDetail(result, 'gh pr review failed') };
}

async function merge(run: GhRunner, args: Args, context: PrToolContext): Promise<Result> {
  const number = pullRequestNumber(args);
  const method: PullRequestMergeMethod = oneOf('method', args.method, PULL_REQUEST_MERGE_METHODS);
  const { workspace, signal } = context;
  const pullRequest = await readPullRequest(run, number, workspace, signal);
  const commit = pullRequest?.headCommit;
  if (pullRequest === undefined || commit === undefined) {
    return { ...unreadable(number), merged: false, reason: 'failed' };
  }
  const checks = await readChecks(run, number, workspace, signal);
  // The checks belong to the head they were read against: if it moved, they say nothing about this commit.
  const after = await readPullRequest(run, number, workspace, signal);
  if (checks === undefined || after?.headCommit !== commit) {
    return {
      ok: false,
      merged: false,
      reason: 'not-ready',
      detail: 'The checks could not be read for this head commit. Try again.',
    };
  }
  const blockers = mergeBlockers({ view: pullRequest, checks: checks.state });
  if (blockers.length > 0) return { ok: false, merged: false, reason: 'not-ready', blockers };
  // Never --admin, --auto or --delete-branch: branch protection stays GitHub's, the branch stays.
  const result = await run(
    ['pr', 'merge', String(number), `--${method}`, '--match-head-commit', commit],
    workspace,
    signal,
  );
  if (result.exitCode === 0) return { ok: true, merged: true, number, method };
  return {
    ok: false,
    merged: false,
    reason: 'failed',
    detail: failureDetail(result, 'gh pr merge failed'),
  };
}

/**
 * View, review and merge an existing pull request through the signed-in `gh`.
 *
 * Every argument list is fixed here; only a validated number, a verdict or
 * method from a closed list, and a bounded review text are placed in it, the
 * text as the value of `--body`. A refusal is a result the model can act on.
 * The caller's permission code decides whether a review or a merge runs at all.
 */
export function createPrTool(run: GhRunner = runGh): PrTool {
  return {
    execute: (operation, args, context) => {
      if (operation === 'view') return view(run, args, context);
      if (operation === 'review') return review(run, args, context);
      if (operation === 'merge') return merge(run, args, context);
      return Promise.reject(new Error(`${PR_TOOL_NAME} ${operation} is not available.`));
    },
  };
}
