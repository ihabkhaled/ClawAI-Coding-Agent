import type { PullRequestMonitorService } from './pull-request-monitor-service';
import type { PullRequestService } from './pull-request-service';
import type { RuntimeToolRegistration } from './runtime-tool-router';

export interface RuntimeStudioPullRequests {
  readonly service: PullRequestService;
  readonly monitor: PullRequestMonitorService;
  readonly registration: RuntimeToolRegistration;
}
