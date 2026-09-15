import { describe, expect, it, vi } from 'vitest';

import { findingSchema } from '../../src/core/findings';
import { FindingsService } from '../../src/services/findings-service';
import { SubAgentFindingsObserver } from '../../src/services/sub-agent-findings-observer';

import type { Finding } from '../../src/core/findings';
import type { SubAgentOutcome } from '../../src/core/multi-agent-dag';

function finding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    title: 'Unvalidated redirect',
    severity: 'high',
    confidence: 'high',
    path: 'src/auth/login.ts',
    line: 42,
    detail: 'The target comes straight from the query string.',
    remediation: 'Allow only same-origin targets.',
    ...overrides,
  });
}

function outcome(overrides: Partial<SubAgentOutcome> = {}): SubAgentOutcome {
  return {
    taskId: 'review-auth',
    status: 'succeeded',
    changedPaths: [],
    tokens: 0,
    toolCalls: 0,
    artifacts: [],
    findings: [],
    ...overrides,
  };
}

function subject() {
  const inner = { status: vi.fn(), outcome: vi.fn() };
  const update = vi.fn();
  const findings = new FindingsService({ update });
  return { inner, findings, observer: new SubAgentFindingsObserver(inner, findings) };
}

describe('SubAgentFindingsObserver', () => {
  it('still forwards status and outcome to the diagnostics sink', () => {
    const { observer, inner } = subject();
    const reported = outcome();

    observer.status('review-auth', 'running');
    observer.outcome(reported);

    expect(inner.status).toHaveBeenCalledWith('review-auth', 'running', undefined);
    expect(inner.outcome).toHaveBeenCalledWith(reported);
  });

  it('files what a reviewer found so it reaches the Findings view', () => {
    const { observer, findings } = subject();

    observer.outcome(outcome({ findings: [finding()] }));

    expect(findings.current().total).toBe(1);
  });

  it('merges two reviewers reporting the same claim', () => {
    const { observer, findings } = subject();

    observer.outcome(outcome({ taskId: 'review-a', findings: [finding()] }));
    observer.outcome(
      outcome({ taskId: 'review-b', findings: [finding({ detail: 'Said differently.' })] }),
    );

    expect(findings.current().total).toBe(1);
  });

  // A reviewer that was cancelled may still have reported before it stopped,
  // and what it found is not conditional on how its task ended.
  it('keeps findings from a cancelled or blocked reviewer', () => {
    const { observer, findings } = subject();

    observer.outcome(outcome({ status: 'cancelled', findings: [finding()] }));
    observer.outcome(
      outcome({
        taskId: 'other',
        status: 'blocked',
        blocker: 'lease',
        findings: [finding({ title: 'Missing rate limit', path: 'src/api.ts' })],
      }),
    );

    expect(findings.current().total).toBe(2);
  });

  it('records nothing when a task reported nothing', () => {
    const { observer, findings } = subject();

    observer.outcome(outcome());

    expect(findings.current().total).toBe(0);
  });
});
