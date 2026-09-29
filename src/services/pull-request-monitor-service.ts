import { composeCheckFixPrompt, nextPollDelay } from '../core/pull-request';
import { PULL_REQUEST_MONITOR_POLICY } from '../core/pull-request.constants';

import type {
  PullRequestFixStarter,
  PullRequestMonitorDependencies,
  PullRequestMonitorPolicy,
  PullRequestWatchEnd,
  PullRequestWatchState,
} from './pull-request-monitor-service.types';
import type { PullRequestCheckSummary, WatchedPullRequest } from '../core/pull-request.types';

/**
 * Watches the checks on pull requests this agent opened, and offers a fix run
 * when one goes red.
 *
 * Polling rather than a webhook, because a webhook needs somewhere public to
 * land and a VS Code extension has nowhere. The polling is bounded three ways —
 * a doubling delay with a ceiling, a poll limit, and a limit on how many pull
 * requests are watched at once — because an unbounded poll is a network cost
 * nobody agreed to, and CI that has not finished in that window is something a
 * person should look at rather than something to keep asking about.
 *
 * A failure ends the watch and asks once. The fix run is only started when the
 * person says so: a red check can be a flaky runner or an expired secret, and
 * an agent that pushes a "fix" for either makes the pull request worse.
 */
export class PullRequestMonitorService {
  private readonly watches = new Map<string, PullRequestWatchState>();
  private readonly policy: PullRequestMonitorPolicy;
  private fix: PullRequestFixStarter | undefined;
  private disposed = false;

  constructor(
    private readonly dependencies: PullRequestMonitorDependencies,
    private readonly ended: (pr: WatchedPullRequest, end: PullRequestWatchEnd) => void = () => {
      // Nobody listening is the normal case outside tests.
    },
  ) {
    this.policy = dependencies.policy ?? PULL_REQUEST_MONITOR_POLICY;
  }

  /** Where "fix it" goes. Bound after construction, by whoever can start a run. */
  bindFix(starter: PullRequestFixStarter): void {
    this.fix = starter;
  }

  /** Starts watching; false when it already is, or when the watch limit is reached. */
  watch(pr: WatchedPullRequest): boolean {
    if (this.disposed || this.watches.has(pr.url)) return false;
    if (this.watches.size >= this.policy.maxWatched) return false;
    const state: PullRequestWatchState = { pr, polls: 0, errors: 0 };
    this.watches.set(pr.url, state);
    this.schedule(state);
    return true;
  }

  watching(): readonly WatchedPullRequest[] {
    return [...this.watches.values()].map((state) => state.pr);
  }

  stop(url: string): void {
    const state = this.watches.get(url);
    if (state !== undefined) this.end(state, 'stopped');
  }

  dispose(): void {
    this.disposed = true;
    for (const state of [...this.watches.values()]) this.end(state, 'stopped');
  }

  private schedule(state: PullRequestWatchState): void {
    state.handle = this.dependencies.timers.set(
      () => {
        void this.poll(state);
      },
      nextPollDelay(state.polls, this.policy),
    );
  }

  private async poll(state: PullRequestWatchState): Promise<void> {
    if (this.disposed || this.watches.get(state.pr.url) !== state) return;
    state.polls += 1;
    let summary: PullRequestCheckSummary;
    try {
      summary = await this.dependencies.checks.checks(state.pr.rootKey, state.pr.number);
      state.errors = 0;
    } catch {
      state.errors += 1;
      if (state.errors >= this.policy.maxConsecutiveErrors) this.end(state, 'errored');
      else this.continueOrGiveUp(state);
      return;
    }
    if (this.watches.get(state.pr.url) !== state) return;
    if (summary.state === 'passed') {
      this.end(state, 'passed');
      this.dependencies.alerts.passed(state.pr);
      return;
    }
    if (summary.state === 'failed') {
      this.end(state, 'failed');
      await this.offerFix(state.pr, summary);
      return;
    }
    this.continueOrGiveUp(state);
  }

  private continueOrGiveUp(state: PullRequestWatchState): void {
    if (state.polls >= this.policy.maxPolls) this.end(state, 'gave-up');
    else this.schedule(state);
  }

  private async offerFix(pr: WatchedPullRequest, summary: PullRequestCheckSummary): Promise<void> {
    if (!(await this.dependencies.alerts.failed(pr, summary))) return;
    const fix = this.fix;
    if (fix === undefined) return;
    // Without logs the fix run still starts, from the check names: a log that
    // could not be fetched should not cost the person the run they asked for.
    const report = await this.dependencies.checks
      .failureLogs(pr.rootKey, pr.number)
      .catch(() => ({ summary, logs: '' }));
    const current = report.summary.failing.length > 0 ? report.summary : summary;
    await fix(composeCheckFixPrompt(pr, current, report.logs));
  }

  private end(state: PullRequestWatchState, end: PullRequestWatchEnd): void {
    if (state.handle !== undefined) this.dependencies.timers.clear(state.handle);
    this.watches.delete(state.pr.url);
    this.ended(state.pr, end);
  }
}
