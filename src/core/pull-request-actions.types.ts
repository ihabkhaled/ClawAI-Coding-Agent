import type {
  PULL_REQUEST_MERGE_METHODS,
  PULL_REQUEST_REVIEW_EVENTS,
} from './pull-request-actions.constants';
import type { PullRequestChecksState } from './pull-request.types';

export type PullRequestMergeMethod = (typeof PULL_REQUEST_MERGE_METHODS)[number];
export type PullRequestReviewEvent = (typeof PULL_REQUEST_REVIEW_EVENTS)[number];

/** A pull request as the model reads it: bounded, with the other people's words marked. */
export interface PullRequestView {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly draft: boolean;
  readonly author: string;
  readonly base: string;
  readonly head: string;
  /** The commit the pull request's head branch points at; a merge is bound to it. */
  readonly headCommit: string | undefined;
  readonly mergeable: string;
  readonly mergeState: string;
  readonly reviewDecision: string;
  readonly body: string;
  readonly files: readonly {
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
  readonly filesTruncated: boolean;
  readonly comments: readonly { readonly author: string; readonly body: string }[];
  readonly reviews: readonly {
    readonly author: string;
    readonly state: string;
    readonly body: string;
  }[];
}

/** Why a merge was not attempted. */
export type PullRequestMergeBlocker =
  'not-open' | 'draft' | 'conflicts' | 'changes-requested' | 'checks-failing' | 'checks-pending';

export interface PullRequestMergeFacts {
  readonly view: Pick<PullRequestView, 'state' | 'draft' | 'mergeable' | 'reviewDecision'>;
  readonly checks: PullRequestChecksState;
}

export type PullRequestActionRefusal = 'gh-unavailable' | 'not-approved' | 'not-ready' | 'failed';

export type PullRequestMergeResult =
  | { readonly merged: true; readonly number: number; readonly method: PullRequestMergeMethod }
  | {
      readonly merged: false;
      readonly reason: PullRequestActionRefusal;
      readonly detail: string;
      readonly blockers?: readonly PullRequestMergeBlocker[];
    };

export type PullRequestReviewResult =
  | { readonly reviewed: true; readonly number: number; readonly event: PullRequestReviewEvent }
  | {
      readonly reviewed: false;
      readonly reason: PullRequestActionRefusal;
      readonly detail: string;
    };
