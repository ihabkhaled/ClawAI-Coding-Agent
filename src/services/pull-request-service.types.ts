import type { GitReceipt } from '../core/git-operation';
import type { PullRequestBlocker } from '../core/pull-request-readiness.types';
import type {
  PullRequestCheckSummary,
  PullRequestDraft,
  WatchedPullRequest,
} from '../core/pull-request.types';

export interface PullRequestFilesPort {
  workspaceRootUri(rootKey: string): { readonly fsPath: string };
}

export interface PullRequestGitPort {
  execute(candidate: unknown, signal?: AbortSignal): Promise<GitReceipt>;
}

/** Shows the exact title and description and answers whether to open it. */
export type PullRequestApproval = (
  preview: string,
  hash: string,
  signal?: AbortSignal,
) => Promise<boolean>;

export interface PullRequestDependencies {
  readonly files: PullRequestFilesPort;
  readonly git: PullRequestGitPort;
  readonly approve: PullRequestApproval;
  /** Told about every pull request this service opens, so its checks can be watched. */
  readonly opened: (pr: WatchedPullRequest) => void;
}

export interface PullRequestRequest {
  readonly rootKey: string;
  readonly baseBranch?: string | undefined;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly type?: string | undefined;
  readonly draft?: boolean | undefined;
}

export type PullRequestRefusal =
  'gh-unavailable' | 'not-ready' | 'not-approved' | 'exists' | 'failed';

export type PullRequestPublishResult =
  | {
      readonly published: true;
      readonly url: string;
      readonly number: number;
      readonly title: string;
      readonly pushed: boolean;
    }
  | {
      readonly published: false;
      readonly reason: PullRequestRefusal;
      readonly detail: string;
      readonly blockers?: readonly PullRequestBlocker[];
      readonly url?: string;
    };

export interface PullRequestDraftResult {
  readonly draft: PullRequestDraft;
  readonly branch: string;
  readonly baseBranch: string;
  readonly ready: boolean;
  readonly blockers: readonly PullRequestBlocker[];
}

export interface PullRequestFailureReport {
  readonly summary: PullRequestCheckSummary;
  readonly logs: string;
}
