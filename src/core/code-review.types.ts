import type { REVIEW_DIMENSIONS } from './code-review.constants';
import type { Finding, FindingSelection } from './findings';
import type { SubAgentTask } from './multi-agent-dag';

export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];

export interface ReviewGraphInput {
  readonly rootKey: string;
  readonly runId: string;
  readonly epochs: SubAgentTask['epochs'];
  readonly dimensions: readonly ReviewDimension[];
  readonly diff: string;
  readonly changedPaths: readonly string[];
  /** What the diff is measured against, for the reviewer's own `workspace.git diff`. */
  readonly baseRef: string;
}

export interface ReviewVerification {
  /** Verified, deduplicated and ranked, ready to read top-down. */
  readonly selection: FindingSelection;
  /** Findings about a path the diff does not touch, and so out of this review. */
  readonly rejected: readonly Finding[];
  /** Findings two or more reviewers raised independently. */
  readonly corroborated: number;
}
