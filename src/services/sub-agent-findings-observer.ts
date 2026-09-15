import type { FindingsService } from './findings-service';
import type { SubAgentCoordinatorObserver } from './sub-agent-coordinator-service';
import type { SubAgentOutcome, SubAgentTaskStatus } from '../core/multi-agent-dag';

/**
 * Forwards sub-agent events on, and files what a reviewer found.
 *
 * The diagnostics sink writes outcomes to a log for support, which is not a
 * place anyone reads during a review. Recording the findings as each task ends
 * is what merges several reviewers into one triage-ordered list and puts it in
 * the Findings view — the difference between a reviewer sub-agent that reports
 * and one that only appears to.
 *
 * Composition rather than a second observer slot on the coordinator: the
 * coordinator takes one observer, and two concerns behind one interface is
 * exactly what a decorator is for.
 */
export class SubAgentFindingsObserver implements SubAgentCoordinatorObserver {
  constructor(
    private readonly inner: SubAgentCoordinatorObserver,
    private readonly findings: FindingsService,
  ) {}

  status(taskId: string, status: SubAgentTaskStatus, detail?: string): void {
    this.inner.status(taskId, status, detail);
  }

  outcome(outcome: SubAgentOutcome): void {
    this.inner.outcome(outcome);
    // A cancelled or blocked reviewer may still have reported before it
    // stopped, and those findings are as true as any other. What it found is
    // not conditional on how its task ended.
    if (outcome.findings.length > 0) this.findings.record(outcome.findings);
  }
}
