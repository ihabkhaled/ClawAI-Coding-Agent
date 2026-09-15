import { describe, expect, it, vi } from 'vitest';

import { planRevisionHash } from '../../src/core/plan-revision';
import { RuntimeJournalTracker } from '../../src/services/runtime-journal-tracker';
import { examplePlan } from '../helpers/implementation-plan';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

describe('RuntimeJournalTracker', () => {
  it('checkpoints tool effects and the terminal state from the canonical event stream', async () => {
    const saved: unknown[] = [];
    const save = vi.fn(async (candidate: unknown) => {
      saved.push(candidate);
    });
    const tracker = new RuntimeJournalTracker({ save });
    await tracker.start({
      runId: 'runtime:journal-test',
      threadId: 'thread:journal-test',
      goal: 'Implement the feature',
      policySnapshotHash: `sha256:${'1'.repeat(64)}`,
      capabilitySnapshotHash: `sha256:${'2'.repeat(64)}`,
      fingerprints: {
        account: 'account:test',
        workspace: 'workspace:test',
        target: 'target:workspace',
        policy: 'policy:test',
        files: `sha256:${'3'.repeat(64)}`,
        gitHead: 'a'.repeat(40),
      },
      budget: { maxToolCalls: 10 },
      createdAt: '2026-08-02T12:00:00.000Z',
    });
    await tracker.record(
      event('tool.requested', 0, {
        invocation: {
          schemaVersion: '2.0',
          invocationId: 'invocation:journal-test',
          runId: 'runtime:journal-test',
          turnId: 'turn:journal-test',
          toolName: 'workspace.files',
          toolVersion: '2.0.0',
          operation: 'apply',
          arguments: {},
          targetId: 'target:workspace',
          epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
          idempotencyKey: 'idempotency:journal-test',
          requestedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    );
    await tracker.record(event('tool.completed', 1, {}, 'invocation:journal-test'));
    await tracker.record(event('run.completed', 2, {}));

    const final = saved.at(-1);
    expect(final).toMatchObject({
      lifecycle: 'completed',
      lastEventSequence: 2,
      invocations: [
        expect.objectContaining({
          invocationId: 'invocation:journal-test',
          repeatability: 'non-repeatable',
          effectState: 'committed',
        }),
      ],
    });
    expect(save).toHaveBeenCalledTimes(4);
  });

  it('records the mode and the plan revision the run is working against', async () => {
    const saved: unknown[] = [];
    const save = vi.fn(async (candidate: unknown) => {
      saved.push(candidate);
    });
    const tracker = new RuntimeJournalTracker({ save });
    await tracker.start({
      runId: 'runtime:journal-test',
      threadId: 'thread:journal-test',
      goal: 'Plan the feature',
      policySnapshotHash: `sha256:${'1'.repeat(64)}`,
      capabilitySnapshotHash: `sha256:${'2'.repeat(64)}`,
      fingerprints: {
        account: 'account:test',
        workspace: 'workspace:test',
        target: 'target:workspace',
        policy: 'policy:test',
        files: `sha256:${'3'.repeat(64)}`,
        gitHead: 'a'.repeat(40),
      },
      budget: { maxToolCalls: 10 },
      createdAt: '2026-08-02T12:00:00.000Z',
      agentMode: 'PLAN',
    });
    await tracker.record(
      event('tool.requested', 0, {
        invocation: {
          schemaVersion: '2.0',
          invocationId: 'invocation:planning',
          runId: 'runtime:journal-test',
          turnId: 'turn:journal-test',
          toolName: 'workspace.planning',
          toolVersion: '2.0.0',
          operation: 'export',
          arguments: { plan: JSON.parse(JSON.stringify(examplePlan())) },
          targetId: 'target:workspace',
          epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
          idempotencyKey: 'idempotency:planning',
          requestedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    );

    expect(saved.at(-1)).toMatchObject({
      agentMode: 'PLAN',
      planRevision: planRevisionHash(examplePlan()),
    });
  });
});

function event(
  type: string,
  sequence: number,
  payload: RuntimeEvent['payload'],
  invocationId?: string,
): RuntimeEvent {
  return {
    schemaVersion: '2.0',
    eventId: `event:journal-${String(sequence)}`,
    runId: 'runtime:journal-test',
    turnId: 'turn:journal-test',
    sequence,
    timestamp: '2026-08-02T12:00:00.000Z',
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    payload,
    ...(invocationId === undefined ? {} : { correlation: { invocationId } }),
  };
}
