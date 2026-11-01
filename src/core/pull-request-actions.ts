import { z } from 'zod';

import {
  PULL_REQUEST_BODY_CHARS,
  PULL_REQUEST_COMMENT_CHARS,
  PULL_REQUEST_MAX_COMMENTS,
  PULL_REQUEST_MAX_FILES,
} from './pull-request-actions.constants';

import type {
  PullRequestMergeBlocker,
  PullRequestMergeFacts,
  PullRequestMergeMethod,
  PullRequestReviewEvent,
  PullRequestView,
} from './pull-request-actions.types';

const HEAD_COMMIT_PATTERN = /^[0-9a-f]{40,64}$/u;

const text = (limit: number) =>
  z
    .string()
    .default('')
    .transform((value) => cut(value, limit));
const person = z
  .object({ login: z.string().default('unknown') })
  .partial()
  .default({});

const viewSchema = z.object({
  number: z.number().int(),
  title: text(300),
  url: text(500),
  state: text(20),
  isDraft: z.boolean().default(false),
  author: person,
  baseRefName: text(200),
  headRefName: text(200),
  headRefOid: z.string().regex(HEAD_COMMIT_PATTERN).optional(),
  mergeable: text(20),
  mergeStateStatus: text(30),
  reviewDecision: text(30),
  body: text(PULL_REQUEST_BODY_CHARS),
  files: z
    .array(
      z.object({
        path: text(400),
        additions: z.number().int().default(0),
        deletions: z.number().int().default(0),
      }),
    )
    .default([]),
  comments: z
    .array(z.object({ author: person, body: text(PULL_REQUEST_COMMENT_CHARS) }))
    .default([]),
  reviews: z
    .array(z.object({ author: person, state: text(30), body: text(PULL_REQUEST_COMMENT_CHARS) }))
    .default([]),
});

function cut(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** What `gh pr view --json` said, bounded; undefined when it was not a pull request. */
export function summarizePullRequest(candidate: unknown): PullRequestView | undefined {
  const parsed = viewSchema.safeParse(candidate);
  if (!parsed.success) return undefined;
  const view = parsed.data;
  return {
    number: view.number,
    title: view.title,
    url: view.url,
    state: view.state,
    draft: view.isDraft,
    author: view.author.login ?? 'unknown',
    base: view.baseRefName,
    head: view.headRefName,
    headCommit: view.headRefOid,
    mergeable: view.mergeable,
    mergeState: view.mergeStateStatus,
    reviewDecision: view.reviewDecision,
    body: view.body,
    files: view.files.slice(0, PULL_REQUEST_MAX_FILES),
    filesTruncated: view.files.length > PULL_REQUEST_MAX_FILES,
    comments: view.comments
      .slice(-PULL_REQUEST_MAX_COMMENTS)
      .map((entry) => ({ author: entry.author.login ?? 'unknown', body: entry.body })),
    reviews: view.reviews.slice(-PULL_REQUEST_MAX_COMMENTS).map((entry) => ({
      author: entry.author.login ?? 'unknown',
      state: entry.state,
      body: entry.body,
    })),
  };
}

/**
 * Everything that stands between a pull request and a merge, in the order to
 * fix it. Branch protection is still enforced by GitHub itself: this only
 * refuses what is plainly not ready, so the person is never asked to approve a
 * merge that cannot happen.
 */
export function mergeBlockers(facts: PullRequestMergeFacts): PullRequestMergeBlocker[] {
  const blockers: PullRequestMergeBlocker[] = [];
  if (facts.view.state !== 'OPEN') blockers.push('not-open');
  if (facts.view.draft) blockers.push('draft');
  if (facts.view.mergeable === 'CONFLICTING') blockers.push('conflicts');
  if (facts.view.reviewDecision === 'CHANGES_REQUESTED') blockers.push('changes-requested');
  if (facts.checks === 'failed') blockers.push('checks-failing');
  if (facts.checks === 'pending') blockers.push('checks-pending');
  return blockers;
}

/** The exact words the person reads before a merge is made. */
export function mergePreview(
  view: PullRequestView,
  method: PullRequestMergeMethod,
  checks: string,
): string {
  return [
    `Merge #${String(view.number)}: ${view.title}`,
    `Into: ${view.base}  From: ${view.head}  By: ${view.author}`,
    `Head commit: ${view.headCommit ?? 'unknown'}`,
    `Method: ${method}`,
    `Checks: ${checks}`,
    `Files: ${String(view.files.length)}${view.filesTruncated ? '+' : ''}`,
    'This cannot be taken back from here.',
  ].join('\n');
}

/** The exact words the person reads before a review is posted. */
export function reviewPreview(
  view: Pick<PullRequestView, 'number' | 'title'>,
  event: PullRequestReviewEvent,
  body: string,
): string {
  return [`Review #${String(view.number)}: ${view.title}`, `Verdict: ${event}`, '', body].join(
    '\n',
  );
}

/** The `gh pr review` flag for a verdict. */
export function reviewFlag(event: PullRequestReviewEvent): string {
  if (event === 'approve') return '--approve';
  if (event === 'request-changes') return '--request-changes';
  return '--comment';
}
