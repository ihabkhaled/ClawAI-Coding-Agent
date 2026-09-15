/** Why a branch is not ready to open a pull request from. */
export type PullRequestBlocker =
  'no-remote' | 'on-base-branch' | 'nothing-to-propose' | 'uncommitted-changes' | 'not-pushed';

/** What was observed about the branch, before anything is concluded from it. */
export interface PullRequestFacts {
  readonly currentBranch: string;
  readonly baseBranch: string;
  readonly remotes: readonly string[];
  /** Commits on this branch that the base does not have. */
  readonly aheadBy: number;
  /** Commits on the base that this branch does not have. */
  readonly behindBy: number;
  /** Paths with uncommitted changes, staged or not. */
  readonly dirtyPaths: readonly string[];
  /** Whether the branch has been pushed to a remote at all. */
  readonly hasUpstream: boolean;
}

export interface PullRequestReadiness {
  readonly ready: boolean;
  /** Ordered by what to fix first, so the caller acts on one thing at a time. */
  readonly blockers: readonly PullRequestBlocker[];
  /** True but not disqualifying, such as a branch that has fallen behind. */
  readonly warnings: readonly string[];
}
