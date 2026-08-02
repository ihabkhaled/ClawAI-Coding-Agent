import { describe, expect, it, vi } from 'vitest';

import { safeRuntimeFixtureDefinition } from '../../src/infrastructure/safe-runtime-fixture-executor';
import { RuntimeRunService } from '../../src/services/runtime-run-service';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, policy: 4, target: 3, workspace: 2 };
const start = {
  budget: {
    maxModelTurns: 3,
    maxOutputBytes: 8_192,
    maxRepairAttempts: 1,
    maxRuntimeMs: 10_000,
    maxToolCalls: 3,
    maxToolResultBytes: 4_096,
    maxToolRounds: 3,
  },
  definitions: [safeRuntimeFixtureDefinition],
  epochs,
  threadId: 'thread_01JZZZZZZZZZZZZZZZZZZZZZ',
  clientRequestId: 'request_01JZZZZZZZZZZZZZZZZZZZZ',
  idempotencyKey: 'start_01JZZZZZZZZZZZZZZZZZZZZZZ',
  prompt: 'Read the safe fixture.',
  manifestHash: `sha256:${'1'.repeat(64)}`,
  toolCatalogHash: `sha256:${'2'.repeat(64)}`,
  provider: 'fixture',
  model: 'fixture-model',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
};

function invocation(invocationId: string, turnId = start.turnId): ToolInvocation {
  return {
    arguments: {},
    epochs,
    idempotencyKey: `idem_${invocationId.slice(4)}`,
    invocationId,
    operation: 'read',
    requestedAt: '2026-08-02T08:00:00.000Z',
    runId: start.runId,
    schemaVersion: '2.0',
    targetId: 'target:fixture',
    toolName: safeRuntimeFixtureDefinition.name,
    toolVersion: safeRuntimeFixtureDefinition.version,
    turnId,
  };
}

function serviceHarness(input: {
  readonly execute?: (
    invocation: ToolInvocation,
  ) => Promise<{ structured: { documentCount: number } }>;
  readonly policyDecision?: 'allow' | 'deny';
  readonly publish?: (event: RuntimeEvent) => void;
  readonly submit?: () => Promise<void>;
}) {
  const cancelled: string[] = [];
  const events: RuntimeEvent[] = [];
  const submitted: unknown[] = [];
  const execute = vi.fn(input.execute ?? (async () => ({ structured: { documentCount: 3 } })));
  const service = new RuntimeRunService({
    clock: { now: () => 1_000 },
    currentEpochs: () => epochs,
    eventSink: {
      publishBatch: (batch) => {
        for (const event of batch) input.publish?.(event);
        events.push(...batch);
      },
    },
    executor: { execute },
    policy: {
      evaluate: async () => ({
        code: input.policyDecision === 'deny' ? 'DENIED' : 'ALLOWED',
        decision: input.policyDecision ?? 'allow',
        message: input.policyDecision === 'deny' ? 'Denied.' : 'Allowed.',
      }),
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
    transport: {
      cancel: async (runId) => {
        cancelled.push(runId);
      },
      start: async (run) => ({ runId: run.runId }),
      submitResult: async (_runId, result) => {
        submitted.push(result);
        await input.submit?.();
      },
    },
  });
  return { cancelled, events, execute, service, submitted };
}

describe('RuntimeRunService review boundaries', () => {
  it('rotates tool admission to the explicit model turn and rejects the superseded turn', async () => {
    const { service, submitted } = serviceHarness({});
    await service.start(start);
    const nextTurnId = 'turn_01K22222222222222222222222';

    service.beginModelTurn(false, nextTurnId);

    await expect(
      service.dispatch(invocation('inv_01K11111111111111111111111'), { action: 'final' }),
    ).rejects.toThrow(/turn/i);
    await expect(
      service.dispatch(invocation('inv_01K22222222222222222222222', nextTurnId), {
        action: 'final',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    await expect(
      service.dispatch(invocation('inv_01K22222222222222222222222', nextTurnId), {
        action: 'final',
      }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(submitted).toHaveLength(1);
  });

  it('rolls back staged service events when lifecycle publication fails', async () => {
    let failStarted = true;
    const { events, service, submitted } = serviceHarness({
      publish: (event) => {
        if (failStarted && event.type === 'tool.started') {
          throw new Error('event sink unavailable');
        }
      },
    });
    await service.start(start);
    const request = invocation('inv_01K11111111111111111111111');

    await expect(service.dispatch(request, { action: 'final' })).rejects.toThrow(
      /event sink unavailable/i,
    );
    expect(service.snapshot.runs[start.runId]?.lastSequence).toBe(0);
    expect(service.snapshot.runs[start.runId]?.invocationOrder).toEqual([]);
    expect(events.map((event) => event.type)).toEqual(['run.created']);

    failStarted = false;
    await expect(service.dispatch(request, { action: 'final' })).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(submitted).toHaveLength(1);
    expect(service.snapshot.runs[start.runId]?.timeline.map((event) => event.sequence)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('clears local admission when run-created publication fails so start can retry', async () => {
    let failCreated = true;
    const { cancelled, service } = serviceHarness({
      publish: (event) => {
        if (failCreated && event.type === 'run.created') {
          throw new Error('event sink unavailable');
        }
      },
    });

    await expect(service.start(start)).rejects.toThrow(/event sink unavailable/i);
    expect(cancelled).toEqual([start.runId]);
    expect(service.snapshot.runs).toEqual({});

    failCreated = false;
    await expect(service.start(start)).resolves.toEqual({ runId: start.runId });
    expect(service.snapshot.runs[start.runId]?.lastSequence).toBe(0);
  });

  it('rejects a concurrent late result after another dispatch terminalizes the active run', async () => {
    let resolveFirst: ((value: { structured: { documentCount: number } }) => void) | undefined;
    let executions = 0;
    const firstOutput = new Promise<{ structured: { documentCount: number } }>((resolve) => {
      resolveFirst = resolve;
    });
    let releaseSubmit: (() => void) | undefined;
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const { events, service, submitted } = serviceHarness({
      execute: async () => {
        executions += 1;
        return executions === 1 ? firstOutput : new Promise(() => undefined);
      },
      submit: () => submitGate,
    });
    await service.start(start);
    const first = service.dispatch(invocation('inv_01K11111111111111111111111'), {
      action: 'final',
    });
    const second = service.dispatch(invocation('inv_01K22222222222222222222222'), {
      action: 'final',
    });
    await vi.waitFor(() => {
      expect(executions).toBe(2);
    });

    resolveFirst?.({ structured: { documentCount: 1 } });

    await expect(second).rejects.toThrow(/active run/i);
    releaseSubmit?.();
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
    expect(submitted).toHaveLength(1);
    expect(events.filter((event) => event.type === 'tool.completed')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run.completed')).toHaveLength(1);
  });

  it('projects policy denial as blocked rather than failed', async () => {
    const { events, service } = serviceHarness({ policyDecision: 'deny' });
    await service.start(start);

    await expect(
      service.dispatch(invocation('inv_01K11111111111111111111111'), { action: 'final' }),
    ).resolves.toMatchObject({ status: 'denied' });

    expect(events.map((event) => event.type).at(-1)).toBe('run.blocked');
    expect(events.map((event) => event.type)).not.toContain('run.failed');
  });

  it('projects a safe executor failure as a failed run', async () => {
    const { events, service } = serviceHarness({
      execute: async () => {
        throw new Error('executor secret');
      },
    });
    await service.start(start);

    await expect(
      service.dispatch(invocation('inv_01K11111111111111111111111'), { action: 'final' }),
    ).resolves.toMatchObject({ status: 'failed' });

    expect(events.map((event) => event.type).at(-1)).toBe('run.failed');
  });

  it('enforces the service steering pending cap without unbounded retained messages', async () => {
    const { service } = serviceHarness({});
    await service.start(start);
    for (let sequence = 0; sequence < 8; sequence += 1) {
      service.receiveSteering({
        epochs,
        idempotencyKey: `steering-key-${String(sequence).padStart(4, '0')}`,
        message: `Message ${String(sequence)}`,
        receivedAt: new Date(Date.UTC(2026, 7, 2, 8, 0, sequence)).toISOString(),
        runId: start.runId,
        schemaVersion: '2.0',
        sequence,
        steeringId: `steering-id-${String(sequence).padStart(4, '0')}`,
      });
    }

    expect(() =>
      service.receiveSteering({
        epochs,
        idempotencyKey: 'steering-key-0008',
        message: 'Overflow.',
        receivedAt: '2026-08-02T08:00:08.000Z',
        runId: start.runId,
        schemaVersion: '2.0',
        sequence: 8,
        steeringId: 'steering-id-0008',
      }),
    ).toThrow(/pending queue is full/i);
    expect(service.snapshot.runs[start.runId]?.steeringOrder).toHaveLength(8);
  });
});
