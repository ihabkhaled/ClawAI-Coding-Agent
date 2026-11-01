import { createHash } from 'node:crypto';

import { tailOf } from '../core/pull-request';
import {
  mergeBlockers,
  mergePreview,
  reviewFlag,
  reviewPreview,
  summarizePullRequest,
} from '../core/pull-request-actions';
import {
  PULL_REQUEST_DIFF_CHARS,
  PULL_REQUEST_REVIEW_BODY_CHARS,
  PULL_REQUEST_UNTRUSTED_NOTICE,
  PULL_REQUEST_VIEW_FIELDS,
} from '../core/pull-request-actions.constants';

import type {
  PullRequestActionsDependencies,
  PullRequestViewResult,
} from './pull-request-actions-service.types';
import type {
  PullRequestMergeMethod,
  PullRequestMergeResult,
  PullRequestReviewEvent,
  PullRequestReviewResult,
  PullRequestView,
} from '../core/pull-request-actions.types';

const GH_MISSING =
  'The GitHub CLI (gh) is not installed or not signed in. Run `gh auth login`, then try again.';

function digest(preview: string): string {
  return `sha256:${createHash('sha256').update(preview).digest('hex')}`;
}

/**
 * Reading, reviewing and merging an existing pull request through the
 * signed-in `gh` CLI, as the developer.
 *
 * Reading changes nothing. A review and a merge each show their exact words to
 * the person first, on top of the runtime policy's own approval, and every
 * refusal is a result the model can act on. A merge never uses `--admin`,
 * `--auto` or `--delete-branch`: branch protection stays GitHub's to enforce,
 * and the branch stays where it is.
 */
export class PullRequestActionsService {
  constructor(private readonly dependencies: PullRequestActionsDependencies) {}

  async view(
    rootKey: string,
    number: number,
    includeDiff: boolean,
    signal?: AbortSignal,
  ): Promise<PullRequestViewResult> {
    const notice = PULL_REQUEST_UNTRUSTED_NOTICE;
    const cwd = this.cwd(rootKey);
    if (!(await this.ghSignedIn(cwd, signal))) return { viewed: false, detail: GH_MISSING, notice };
    const pullRequest = await this.read(cwd, number, signal);
    if (pullRequest === undefined) {
      return {
        viewed: false,
        detail: `Pull request #${String(number)} could not be read.`,
        notice,
      };
    }
    if (!includeDiff) return { viewed: true, pullRequest, notice };
    const diff = await this.dependencies.run('gh', ['pr', 'diff', String(number)], cwd, signal);
    const text = diff.exitCode === 0 ? diff.stdout.slice(0, PULL_REQUEST_DIFF_CHARS) : '';
    return { viewed: true, pullRequest, diff: text, notice };
  }

  async review(
    rootKey: string,
    request: { number: number; event: PullRequestReviewEvent; body: string },
    signal?: AbortSignal,
  ): Promise<PullRequestReviewResult> {
    const { number, event, body } = request;
    if (body.length > PULL_REQUEST_REVIEW_BODY_CHARS) {
      return { reviewed: false, reason: 'failed', detail: 'The review text is too long.' };
    }
    if (event !== 'approve' && body.trim().length === 0) {
      return {
        reviewed: false,
        reason: 'failed',
        detail: 'A comment or change request needs text.',
      };
    }
    const cwd = this.cwd(rootKey);
    if (!(await this.ghSignedIn(cwd, signal))) {
      return { reviewed: false, reason: 'gh-unavailable', detail: GH_MISSING };
    }
    const view = await this.read(cwd, number, signal);
    if (view === undefined) {
      return {
        reviewed: false,
        reason: 'failed',
        detail: `Pull request #${String(number)} could not be read.`,
      };
    }
    const preview = reviewPreview(view, event, body);
    if (!(await this.dependencies.approve('review', preview, digest(preview), signal))) {
      return { reviewed: false, reason: 'not-approved', detail: 'The review was declined.' };
    }
    const result = await this.dependencies.run(
      'gh',
      ['pr', 'review', String(number), reviewFlag(event), '--body', body],
      cwd,
      signal,
    );
    if (result.exitCode === 0) return { reviewed: true, number, event };
    return {
      reviewed: false,
      reason: 'failed',
      detail: tailOf(result.stderr || result.stdout || 'gh pr review failed', 2_000),
    };
  }

  async merge(
    rootKey: string,
    request: { number: number; method: PullRequestMergeMethod },
    signal?: AbortSignal,
  ): Promise<PullRequestMergeResult> {
    const { number, method } = request;
    const cwd = this.cwd(rootKey);
    if (!(await this.ghSignedIn(cwd, signal))) {
      return { merged: false, reason: 'gh-unavailable', detail: GH_MISSING };
    }
    const view = await this.read(cwd, number, signal);
    if (view === undefined) {
      return {
        merged: false,
        reason: 'failed',
        detail: `Pull request #${String(number)} could not be read.`,
      };
    }
    const checks = await this.dependencies.checks(rootKey, number, signal);
    const blockers = mergeBlockers({ view, checks: checks.state });
    if (blockers.length > 0) {
      return {
        merged: false,
        reason: 'not-ready',
        detail: 'Resolve the blockers, then merge again.',
        blockers,
      };
    }
    const preview = mergePreview(view, method, checks.state);
    if (!(await this.dependencies.approve('merge', preview, digest(preview), signal))) {
      return { merged: false, reason: 'not-approved', detail: 'The merge was declined.' };
    }
    const result = await this.dependencies.run(
      'gh',
      ['pr', 'merge', String(number), `--${method}`],
      cwd,
      signal,
    );
    if (result.exitCode === 0) return { merged: true, number, method };
    return {
      merged: false,
      reason: 'failed',
      detail: tailOf(result.stderr || result.stdout || 'gh pr merge failed', 2_000),
    };
  }

  private async read(
    cwd: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestView | undefined> {
    const result = await this.dependencies.run(
      'gh',
      ['pr', 'view', String(number), '--json', PULL_REQUEST_VIEW_FIELDS],
      cwd,
      signal,
    );
    if (result.exitCode !== 0) return undefined;
    try {
      return summarizePullRequest(JSON.parse(result.stdout));
    } catch {
      return undefined;
    }
  }

  private cwd(rootKey: string): string {
    return this.dependencies.files.workspaceRootUri(rootKey).fsPath;
  }

  private async ghSignedIn(cwd: string, signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.dependencies.run('gh', ['auth', 'status'], cwd, signal)).exitCode === 0;
    } catch {
      return false;
    }
  }
}
