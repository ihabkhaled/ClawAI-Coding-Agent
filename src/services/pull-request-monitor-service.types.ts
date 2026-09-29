import type { PullRequestFailureReport } from './pull-request-service.types';
import type { TimerPort } from './scheduled-task-service.types';
import type { PullRequestCheckSummary, WatchedPullRequest } from '../core/pull-request.types';

export interface PullRequestChecksPort {
  checks(rootKey: string, number: number, signal?: AbortSignal): Promise<PullRequestCheckSummary>;
  failureLogs(
    rootKey: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestFailureReport>;
}

/** How the person hears about a watched pull request, and answers. */
export interface PullRequestAlertPort {
  /** Resolves true when the person asked for a fix run. */
  failed(pr: WatchedPullRequest, summary: PullRequestCheckSummary): Promise<boolean>;
  passed(pr: WatchedPullRequest): void;
}

/** Starts an agent run from a prompt. Bound late: the run starter is built after the studio. */
export type PullRequestFixStarter = (prompt: string) => Promise<void>;

export interface PullRequestMonitorPolicy {
  readonly firstDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxPolls: number;
  readonly maxConsecutiveErrors: number;
  readonly maxWatched: number;
}

export interface PullRequestMonitorDependencies {
  readonly checks: PullRequestChecksPort;
  readonly alerts: PullRequestAlertPort;
  readonly timers: TimerPort;
  readonly policy?: PullRequestMonitorPolicy;
}

export type PullRequestWatchEnd = 'passed' | 'failed' | 'gave-up' | 'errored' | 'stopped';

/** One pull request being watched, and how far its polling has gone. */
export interface PullRequestWatchState {
  readonly pr: WatchedPullRequest;
  polls: number;
  errors: number;
  handle?: unknown;
}
