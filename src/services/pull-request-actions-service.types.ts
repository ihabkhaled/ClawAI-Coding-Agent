import type { CommandResult } from '../core/command-spec';
import type { PullRequestView } from '../core/pull-request-actions.types';
import type { PullRequestCheckSummary } from '../core/pull-request.types';

/** Shows the exact words of an action and answers whether to go ahead. */
export type PullRequestActionApproval = (
  action: 'merge' | 'review',
  preview: string,
  hash: string,
  signal?: AbortSignal,
) => Promise<boolean>;

export interface PullRequestActionsDependencies {
  readonly files: { workspaceRootUri(rootKey: string): { readonly fsPath: string } };
  readonly approve: PullRequestActionApproval;
  readonly checks: (
    rootKey: string,
    number: number,
    signal?: AbortSignal,
  ) => Promise<PullRequestCheckSummary>;
  readonly run: (
    executable: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<CommandResult>;
}

export interface PullRequestViewResult {
  readonly viewed: boolean;
  readonly detail?: string;
  readonly pullRequest?: PullRequestView;
  readonly diff?: string;
  readonly notice: string;
}
