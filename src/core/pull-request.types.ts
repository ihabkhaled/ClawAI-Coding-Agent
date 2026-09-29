/** A pull request's title and description, as it will be proposed. */
export interface PullRequestDraft {
  readonly title: string;
  readonly body: string;
  /** A conventional commit message for whatever is still uncommitted. */
  readonly commitMessage: string;
}

/** What a draft is composed from: the branch, its commits, and the run's own summary. */
export interface PullRequestDraftInput {
  readonly branch: string;
  readonly baseBranch: string;
  /** Subjects of the commits the base does not have, oldest first. */
  readonly commitSubjects: readonly string[];
  /** Paths the change touches, used to infer a commit type and scope. */
  readonly changedPaths: readonly string[];
  /** A title the caller already chose; normalized, never discarded. */
  readonly title?: string;
  /** What the run did, in its own words, for the description. */
  readonly summary?: string;
  /** A conventional type the caller already chose. */
  readonly type?: string;
}

/** gh's own classification of a check, which already folds state and conclusion together. */
export type PullRequestCheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface PullRequestCheck {
  readonly name: string;
  readonly bucket: PullRequestCheckBucket;
  readonly link?: string;
  readonly workflow?: string;
}

export type PullRequestChecksState = 'none' | 'pending' | 'passed' | 'failed';

export interface PullRequestCheckSummary {
  readonly state: PullRequestChecksState;
  readonly failing: readonly PullRequestCheck[];
  readonly pending: number;
  readonly total: number;
}

/** A pull request this agent opened, and where to ask about it. */
export interface WatchedPullRequest {
  readonly url: string;
  readonly number: number;
  readonly rootKey: string;
  readonly branch: string;
}
