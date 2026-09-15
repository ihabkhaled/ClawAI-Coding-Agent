import { describe, expect, it } from 'vitest';

import { findingSchema } from '../../src/core/findings';
import { summarizeRun } from '../../src/core/session-recap';

import type { DurableRunJournal, ResumeValidation } from '../../src/core/durable-run-journal';
import type { Finding } from '../../src/core/findings';

type Invocation = DurableRunJournal['invocations'][number];

function invocation(effectState: Invocation['effectState'], index = 0): Invocation {
  return {
    invocationId: `invocation-${String(index)}`,
    idempotencyKey: `idempotency-${String(index)}`,
    repeatability: 'idempotent',
    effectState,
  };
}

function journal(overrides: Partial<DurableRunJournal> = {}): DurableRunJournal {
  return {
    goal: 'Fix the login redirect',
    lifecycle: 'resumable',
    fileTransactionIds: [],
    invocations: [],
    ...overrides,
  } as DurableRunJournal;
}

function resume(reasons: string[]): ResumeValidation {
  return {
    lifecycle: reasons.length === 0 ? 'resumable' : 'blocked-by-drift',
    reasons,
    requiresApproval: false,
    requiresReplan: false,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return findingSchema.parse({
    title: 'Unvalidated redirect',
    severity: 'high',
    confidence: 'high',
    path: 'src/auth/login.ts',
    detail: 'Detail',
    remediation: 'Fix',
    ...overrides,
  });
}

describe('summarizeRun', () => {
  it('counts what the run did, from what was already recorded', () => {
    const recap = summarizeRun(
      journal({
        fileTransactionIds: ['transaction-1', 'transaction-2', 'transaction-3'],
        invocations: [invocation('committed'), invocation('failed', 1), invocation('executing', 2)],
      }),
    );

    expect(recap).toMatchObject({
      goal: 'Fix the login redirect',
      filesChanged: 3,
      toolCalls: 3,
      failedInvocations: 1,
      unfinishedInvocations: 1,
    });
  });

  // They mean different things to a reader: a failure happened and is known,
  // an unfinished one may or may not have taken effect before the host stopped.
  it('separates a failure from an invocation left mid-flight', () => {
    const recap = summarizeRun(
      journal({ invocations: [invocation('prepared'), invocation('executing', 1)] }),
    );

    expect(recap.failedInvocations).toBe(0);
    expect(recap.unfinishedInvocations).toBe(2);
  });

  it('suggests resuming when nothing is in the way', () => {
    expect(summarizeRun(journal()).nextAction).toBe('resume');
  });

  // Ordered by what would be wasted by ignoring it: a drifted workspace has to
  // be replanned before anything else is worth attempting.
  it('puts drift ahead of a stale approval, and both ahead of a failure', () => {
    const failed = { invocations: [invocation('failed')] };

    expect(summarizeRun(journal(failed), resume(['files', 'account'])).nextAction).toBe('replan');
    expect(summarizeRun(journal(failed), resume(['account'])).nextAction).toBe(
      'approve-then-resume',
    );
    expect(summarizeRun(journal(failed), resume([])).nextAction).toBe('investigate-failure');
  });

  it('points at findings when the run is otherwise clean', () => {
    expect(summarizeRun(journal(), resume([]), [finding()]).nextAction).toBe('review-findings');
  });

  // A low-confidence finding is a question rather than a verdict, exactly as it
  // is for the release gate.
  it('does not raise a low-confidence finding as the next action', () => {
    const recap = summarizeRun(journal(), resume([]), [finding({ confidence: 'low' })]);

    expect(recap.blockingFindings).toBe(0);
    expect(recap.nextAction).toBe('resume');
  });

  it('has nothing to suggest for a finished run, unless it left findings', () => {
    expect(summarizeRun(journal({ lifecycle: 'completed' })).nextAction).toBe('nothing');
    expect(summarizeRun(journal({ lifecycle: 'cancelled' }), resume(['files'])).nextAction).toBe(
      'nothing',
    );
    expect(
      summarizeRun(journal({ lifecycle: 'completed' }), resume([]), [finding()]).nextAction,
    ).toBe('review-findings');
  });

  it('reports the blockers in the resume validator words', () => {
    expect(summarizeRun(journal(), resume(['git-head', 'process-loss'])).blockers).toEqual([
      'git-head',
      'process-loss',
    ]);
  });
});
