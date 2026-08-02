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
    eventSink: { publish: (event) => events.push(event) },
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
      start: async (input) => overrides.startReceipt ?? { runId: input.runId },
      submitResult: async (_runId, result) => {
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
      eventSink: { publish: () => undefined },
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

  it('starts, dispatches the safe fixture, submits one result, and replays it exactly', async () => {
    const { events, service, submitted } = harness();
    await service.start(start);

    const first = await service.dispatch(invocation, { action: 'final' });
    const replay = await service.dispatch(invocation, { action: 'final' });

    expect(first).toMatchObject({ status: 'succeeded', structured: { documentCount: 3 } });
    expect(replay).toBe(first);
    expect(submitted).toEqual([first]);
    expect(events).toHaveLength(1);
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
    ).rejects.toThrow(/another run/i);
  });

  it('rejects an account epoch change after start before a tool can execute', async () => {
    let currentEpochs = epochs;
    const { service } = harness({ currentEpochs: () => currentEpochs });
    await service.start(start);
    currentEpochs = { ...epochs, account: 99 };

    await expect(service.dispatch(invocation, { action: 'final' })).rejects.toThrow(/epoch/i);
  });
});
