import {
  PullRequestToolExecutor,
  pullRequestToolDefinition,
} from '../infrastructure/pull-request-tool-executor';
import { ReviewToolExecutor, reviewToolDefinition } from '../infrastructure/review-tool-executor';
import { nodeTimers } from '../infrastructure/schedule-store';
import { VscodePullRequestAlerts } from '../infrastructure/vscode-pull-request-alerts';

import { PullRequestMonitorService } from './pull-request-monitor-service';
import { PullRequestService } from './pull-request-service';
import { pullRequestApproval } from './runtime-studio-approvals';

import type { PullRequestFilesPort, PullRequestGitPort } from './pull-request-service.types';
import type { RuntimeStudioPullRequests } from './runtime-studio-pull-requests.types';
import type { RuntimeToolRegistration } from './runtime-tool-router';
import type { ApprovalBroker } from '../core/approval-broker';
import type { ReviewToolPorts } from '../infrastructure/review-tool-executor.types';

/**
 * The pull request lane: the service that opens one, the monitor that watches
 * its checks, and the tool the model reaches both through.
 *
 * Assembled outside the studio because the studio is a composition root on a
 * 500-line ceiling. Every pull request the service opens is handed straight to
 * the monitor, so "opened" and "watched" cannot drift apart.
 */
export function assemblePullRequests(input: {
  readonly files: PullRequestFilesPort;
  readonly git: PullRequestGitPort;
  readonly approvals: ApprovalBroker;
}): RuntimeStudioPullRequests {
  const service = new PullRequestService({
    files: input.files,
    git: input.git,
    approve: pullRequestApproval(input.approvals),
    opened: (pr) => {
      monitor.watch(pr);
    },
  });
  const monitor = new PullRequestMonitorService({
    checks: service,
    alerts: new VscodePullRequestAlerts(),
    timers: nodeTimers,
  });
  return {
    service,
    monitor,
    registration: {
      definition: pullRequestToolDefinition,
      executor: new PullRequestToolExecutor(service),
    },
  };
}

/** Multi-agent review over the sub-agent coordinator the studio already built. */
export function reviewToolRegistration(ports: ReviewToolPorts): RuntimeToolRegistration {
  return { definition: reviewToolDefinition, executor: new ReviewToolExecutor(ports) };
}
