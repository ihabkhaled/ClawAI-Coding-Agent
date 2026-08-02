import { describe, expect, it } from 'vitest';

import {
  SafeRuntimeFixtureExecutor,
  safeRuntimeFixtureDefinition,
} from '../../src/infrastructure/safe-runtime-fixture-executor';
import { RuntimeRunService } from '../../src/services/runtime-run-service';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const start = {
  budget: {
    maxModelTurns: 2,
    maxOutputBytes: 4096,
    maxRepairAttempts: 1,
    maxRuntimeMs: 10_000,
    maxToolCalls: 2,
    maxToolResultBytes: 2048,
    maxToolRounds: 2,
  },
  definitions: [safeRuntimeFixtureDefinition],
  epochs,
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
};
const invocation = {
  schemaVersion: '2.0' as const,
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: start.runId,
  turnId: start.turnId,
  toolName: safeRuntimeFixtureDefinition.name,
  toolVersion: safeRuntimeFixtureDefinition.version,
  operation: 'read',
  arguments: {},
  targetId: 'target:fixture',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
};

function harness(
  overrides: {
    currentEpochs?: () => typeof epochs;
    execute?: () => Promise<{ modelText?: string; structured?: Record<string, string | number> }>;
    onSubmit?: () => void;
    policy?: () => Promise<{ code: string; decision: 'allow' | 'deny'; message: string }>;
    policyDecision?: 'allow' | 'deny';
    startReceipt?: { runId: string };
  } = {},
) {
  const events: unknown[] = [];
  const submitted: unknown[] = [];
  const cancelled: string[] = [];
  let now = 1_000;
  const service = new RuntimeRunService({
    clock: { now: () => now },
    currentEpochs: overrides.currentEpochs ?? (() => epochs),
    eventSink: { publishBatch: (batch) => events.push(...batch) },
    executor:
      overrides.execute === undefined
        ? new SafeRuntimeFixtureExecutor({ documentCount: 3, workspaceLabel: 'Fixture' })
        : { execute: overrides.execute },
    policy: {
      evaluate:
        overrides.policy ??
        (async () => ({
          code: overrides.policyDecision === 'deny' ? 'POLICY_DENIED' : 'POLICY_ALLOWED',
          decision: overrides.policyDecision ?? ('allow' as const),
          message: overrides.policyDecision === 'deny' ? 'Denied.' : 'Allowed.',
        })),
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
    transport: {
      cancel: async (runId) => {
        cancelled.push(runId);
      },
      start: async (input) => overrides.startReceipt ?? { runId: input.runId },
      submitResult: async (_runId, result) => {
        overrides.onSubmit?.();
        submitted.push(result);
      },
    },
  });
  return {
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    cancelled,
    events,
    service,
    submitted,
  };
}

describe('RuntimeRunService', () => {
  it('requires an admitted run before dispatch or cancellation', async () => {
    const { service } = harness();

    expect(service.snapshot.runs).toEqual({});
    await expect(service.dispatch(invocation, { action: 'final' })).rejects.toThrow(
      /no runtime run/i,
    );
    await expect(service.cancel()).rejects.toThrow(/no runtime run/i);
  });

  it('fails closed when the transport acknowledges a different run', async () => {
    const { cancelled, service } = harness({ startReceipt: { runId: 'run-id-other' } });

    await expect(service.start(start)).rejects.toThrow(/mismatched run/i);
    expect(cancelled).toEqual(['run-id-other']);
  });

  it('compensates a remotely admitted run when epochs change during start', async () => {
    let currentEpochs = epochs;
    const cancelled: string[] = [];
    const service = new RuntimeRunService({
      clock: { now: () => 1_000 },
      currentEpochs: () => currentEpochs,
      eventSink: { publishBatch: () => undefined },
      executor: new SafeRuntimeFixtureExecutor({ documentCount: 3, workspaceLabel: 'Fixture' }),
      policy: {
        evaluate: async () => ({
          code: 'POLICY_ALLOWED',
          decision: 'allow' as const,
          message: 'Allowed.',
        }),
      },
      receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
      transport: {
        cancel: async (runId) => {
          cancelled.push(runId);
        },
        start: async (input) => {
          currentEpochs = { ...epochs, workspace: 99 };
          return { runId: input.runId };
        },
        submitResult: async () => undefined,
      },
    });

    await expect(service.start(start)).rejects.toThrow(/epoch/i);
    expect(cancelled).toEqual([start.runId]);
  });

  it('reduces run creation before the event sink observes sequence zero', async () => {
    const observedSequences: number[] = [];
    const holder: { service?: RuntimeRunService } = {};
    const service = new RuntimeRunService({
      clock: { now: () => 1_000 },
      currentEpochs: () => epochs,
      eventSink: {
        publishBatch: () => {
          observedSequences.push(holder.service?.snapshot.runs[start.runId]?.lastSequence ?? -1);
        },
      },
      executor: new SafeRuntimeFixtureExecutor({ documentCount: 3, workspaceLabel: 'Fixture' }),
      policy: {
        evaluate: async () => ({ code: 'ALLOW', decision: 'allow', message: 'Allowed.' }),
      },
      receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
      transport: {
        cancel: async () => undefined,
        start: async (input) => ({ runId: input.runId }),
        submitResult: async () => undefined,
      },
    });
    holder.service = service;

    await service.start(start);

    expect(observedSequences).toEqual([0]);
  });

  it('starts, dispatches the safe fixture, submits one result, and replays it exactly', async () => {
    const { events, service, submitted } = harness();
    await service.start(start);
    expect(service.snapshot.runs[start.runId]?.lastSequence).toBe(0);

    const first = await service.dispatch(invocation, { action: 'final' });
    const replay = await service.dispatch(invocation, { action: 'final' });

    expect(first).toMatchObject({ status: 'succeeded', structured: { documentCount: 3 } });
    expect(replay).toBe(first);
    expect(service.snapshot.runs[start.runId]?.status).toBe('completed');
    expect(submitted).toEqual([first]);
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'run.created',
      'tool.requested',
      'tool.started',
      'run.budget.updated',
      'run.budget.updated',
      'tool.completed',
      'run.completed',
    ]);
    expect(events.map((event) => (event as { sequence: number }).sequence)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('closes steering when a final tool result terminates the runtime', async () => {
    const { service } = harness();
    await service.start(start);
    await service.dispatch(invocation, { action: 'final' });

    expect(() =>
      service.receiveSteering({
        schemaVersion: '2.0',
        steeringId: 'steering-id-0001',
        runId: start.runId,
        sequence: 0,
        idempotencyKey: 'steering-key-0001',
        message: 'Late request.',
        epochs,
        receivedAt: '2026-08-02T08:00:00.000Z',
      }),
    ).toThrow(/completed/i);
  });

  it('releases a terminal run for the next admission while preserving exact replays', async () => {
    const { service } = harness();
    await service.start(start);
    const result = await service.dispatch(invocation, { action: 'final' });

    await expect(service.dispatch(invocation, { action: 'final' })).resolves.toBe(result);
    await expect(
      service.start({
        ...start,
        runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZY',
        turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZY',
      }),
    ).resolves.toMatchObject({ runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZY' });
  });

  it('rejects stale epochs and cancellation before a result can be submitted', async () => {
    const { cancelled, service, submitted } = harness();
    await service.start(start);

    await expect(
      service.dispatch(
        { ...invocation, epochs: { ...epochs, workspace: 99 } },
        { action: 'final' },
      ),
    ).rejects.toThrow(/epoch/i);
    await service.cancel();

    await expect(service.dispatch(invocation, { action: 'final' })).rejects.toThrow(/cancelled/i);
    expect(cancelled).toEqual([start.runId]);
    expect(submitted).toEqual([]);
  });

  it('accepts steering in order and applies it only at a safe boundary', async () => {
    const { service } = harness();
    await service.start(start);
    const message = {
      schemaVersion: '2.0' as const,
      steeringId: 'steering-id-0001',
      runId: start.runId,
      sequence: 0,
      idempotencyKey: 'steering-key-0001',
      message: 'Prefer a concise result.',
      epochs,
      receivedAt: '2026-08-02T08:00:00.000Z',
    };

    expect(service.receiveSteering(message).entries[0]).toMatchObject({ status: 'received' });
    expect(() => service.applySteering(message.steeringId, 'unsafe-boundary')).toThrow(
      /safe boundary/i,
    );
    expect(
      service.applySteering(message.steeringId, 'model-turn-boundary').entries[0],
    ).toMatchObject({ status: 'applied' });
  });

  it('rejects a foreign run after admission and refuses a second active start', async () => {
    const { service } = harness();
    await service.start(start);

    await expect(service.start(start)).rejects.toThrow(/already active/i);
    await expect(
      service.dispatch({ ...invocation, runId: 'run-id-other' }, { action: 'final' }),
    ).rejects.toThrow(/another run/i);
    await expect(
      service.dispatch({ ...invocation, turnId: 'turn-id-other' }, { action: 'final' }),
    ).rejects.toThrow(/another turn/i);
  });

  it('rejects an account epoch change after start before a tool can execute', async () => {
    let currentEpochs = epochs;
    const { service } = harness({ currentEpochs: () => currentEpochs });
    await service.start(start);
    currentEpochs = { ...epochs, account: 99 };

    await expect(service.dispatch(invocation, { action: 'final' })).rejects.toThrow(/epoch/i);
  });

  it('records explicit model and repair boundaries without tool-dispatch double debits', async () => {
    const { events, service } = harness();
    await service.start(start);

    expect(service.beginModelTurn(false, 'turn_01K11111111111111111111111').usage).toMatchObject({
      modelTurns: 1,
      repairAttempts: 0,
    });
    expect(service.beginModelTurn(true, 'turn_01K22222222222222222222222').usage).toMatchObject({
      modelTurns: 2,
      repairAttempts: 1,
    });
    await service.dispatch(
      { ...invocation, turnId: 'turn_01K22222222222222222222222' },
      { action: 'final' },
    );

    const budgetEvents = events.filter(
      (event): event is { type: string; payload: { usage: { modelTurns: number } } } =>
        (event as { type: string }).type === 'run.budget.updated',
    );
    expect(budgetEvents.at(-1)?.payload.usage.modelTurns).toBe(2);
    expect(
      events.filter((event) => (event as { type: string }).type === 'model.turn.started'),
    ).toHaveLength(2);
  });

  it('fails the explicit model boundary before an exhausted model or repair budget emits an event', async () => {
    const { events, service } = harness();
    await service.start({
      ...start,
      budget: { ...start.budget, maxModelTurns: 1, maxRepairAttempts: 0 },
    });
    service.beginModelTurn();
    await expect(Promise.resolve().then(() => service.beginModelTurn())).rejects.toThrow(
      /model turn/i,
    );
    await expect(Promise.resolve().then(() => service.beginModelTurn(true))).rejects.toThrow(
      /model turn/i,
    );
    expect(
      events.filter((event) => (event as { type: string }).type === 'model.turn.started'),
    ).toHaveLength(1);
  });

  it.each([
    { toolName: 'fixture.unknown' },
    { toolVersion: '2.0' },
    { operation: 'write' },
    { targetId: 'target:unknown' },
  ])('rejects an unknown invocation before it publishes lifecycle events', async (change) => {
    const { events, service, submitted } = harness();
    await service.start(start);

    await expect(
      service.dispatch({ ...invocation, ...change }, { action: 'final' }),
    ).rejects.toThrow();
    expect(events.map((event) => (event as { type: string }).type)).toEqual(['run.created']);
    expect(submitted).toEqual([]);
  });

  it('records a denied tool result without executing the fixture', async () => {
    const { events, service, submitted } = harness({ policyDecision: 'deny' });
    await service.start(start);

    const result = await service.dispatch(invocation, { action: 'final' });

    expect(result.status).toBe('denied');
    expect(submitted).toHaveLength(1);
    expect(events.map((event) => (event as { type: string }).type)).toContain('tool.completed');
    expect(events.map((event) => (event as { type: string }).type)).toContain('run.blocked');
  });
});
