import { describe, expect, it, vi } from 'vitest';

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

describe('RuntimeRunService security boundaries', () => {
  it.each([
    ['tool call', { maxToolCalls: 0, maxToolRounds: 0 }],
    ['tool round', { maxToolCalls: 1, maxToolRounds: 0 }],
  ])(
    'rejects an exhausted %s budget before policy, effects, or lifecycle publication',
    async (_label, limits) => {
      const policy = vi.fn(async () => ({
        code: 'POLICY_ALLOWED',
        decision: 'allow' as const,
        message: 'Allowed.',
      }));
      const execute = vi.fn(async () => ({ structured: { documentCount: 1 } }));
      const { events, service, submitted } = harness({ execute, policy });
      await service.start({ ...start, budget: { ...start.budget, ...limits } });

      await expect(service.dispatch(invocation, { action: 'final' })).rejects.toThrow(/budget/i);

      expect(policy).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(submitted).toEqual([]);
      expect(events.map((entry) => (entry as { type: string }).type)).toEqual(['run.created']);
    },
  );

  it.each([
    ['output byte', { maxOutputBytes: 1_024, maxToolResultBytes: 1_048_576 }],
    ['tool result byte', { maxOutputBytes: 16_777_216, maxToolResultBytes: 1_024 }],
  ])('fails closed when cumulative %s usage is exhausted', async (_label, limits) => {
    const execute = vi.fn(async () => ({ modelText: 'x'.repeat(700) }));
    const { events, service, submitted } = harness({ execute });
    await service.start({
      ...start,
      budget: { ...start.budget, ...limits, maxToolCalls: 2, maxToolRounds: 2 },
    });
    const firstInvocation = { ...invocation };
    const secondInvocation = {
      ...invocation,
      idempotencyKey: 'idem_01K22222222222222222222222',
      invocationId: 'inv_01K22222222222222222222222',
    };
    await service.dispatch(firstInvocation, {
      action: 'continue',
      nextTurnId: 'turn_01K22222222222222222222222',
    });
    await expect(service.dispatch(secondInvocation, { action: 'final' })).rejects.toThrow(/byte/i);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(submitted).toHaveLength(1);
    expect(
      events.filter((entry) => (entry as { type: string }).type === 'tool.completed'),
    ).toHaveLength(1);
    expect(events.map((entry) => (entry as { type: string }).type).slice(-3)).toEqual([
      'tool.requested',
      'tool.started',
      'run.budget.updated',
    ]);
  });

  it('rejects a repair boundary independently before emitting or invoking a provider', async () => {
    const { events, service } = harness();
    await service.start({ ...start, budget: { ...start.budget, maxRepairAttempts: 0 } });

    expect(() => service.beginModelTurn(true)).toThrow(/repair attempt/i);
    expect(events.map((entry) => (entry as { type: string }).type)).toEqual(['run.created']);
  });

  it('rejects a model boundary after the wall-clock deadline without publishing', async () => {
    const { advance, events, service } = harness();
    await service.start({ ...start, budget: { ...start.budget, maxRuntimeMs: 1_000 } });
    advance(1_001);

    expect(() => service.beginModelTurn()).toThrow(/wall-clock/i);
    expect(events.map((entry) => (entry as { type: string }).type)).toEqual(['run.created']);
  });

  it('publishes no late result when cancellation wins an in-flight executor race', async () => {
    let resolveExecution: ((value: { structured: { documentCount: number } }) => void) | undefined;
    const execution = new Promise<{ structured: { documentCount: number } }>((resolve) => {
      resolveExecution = resolve;
    });
    const { events, service, submitted } = harness({ execute: () => execution });
    await service.start(start);
    const pending = service.dispatch(invocation, { action: 'final' });
    await vi.waitFor(() => {
      expect(events.map((entry) => (entry as { type: string }).type)).toContain('tool.started');
    });

    await service.cancel();
    resolveExecution?.({ structured: { documentCount: 3 } });

    await expect(pending).rejects.toThrow(/cancel/i);
    expect(submitted).toEqual([]);
    expect(events.map((entry) => (entry as { type: string }).type).at(-1)).toBe('run.cancelled');
    expect(
      events.filter((entry) => (entry as { type: string }).type === 'run.cancelled'),
    ).toHaveLength(1);
    expect(events.map((entry) => (entry as { type: string }).type)).not.toContain('tool.completed');
  });

  it('publishes no completion when epochs drift after execution or during result submission', async () => {
    let current = epochs;
    const afterExecution = harness({
      currentEpochs: () => current,
      execute: async () => {
        current = { ...epochs, target: 99 };
        return { structured: { documentCount: 3 } };
      },
    });
    await afterExecution.service.start(start);
    await expect(afterExecution.service.dispatch(invocation, { action: 'final' })).rejects.toThrow(
      /epoch/i,
    );
    expect(afterExecution.submitted).toEqual([]);
    expect(afterExecution.events.map((entry) => (entry as { type: string }).type)).not.toContain(
      'tool.completed',
    );

    current = epochs;
    const duringSubmit = harness({
      currentEpochs: () => current,
      onSubmit: () => {
        current = { ...epochs, policy: 99 };
      },
    });
    await duringSubmit.service.start(start);
    await expect(duringSubmit.service.dispatch(invocation, { action: 'final' })).rejects.toThrow(
      /epoch/i,
    );
    expect(duringSubmit.submitted).toHaveLength(1);
    expect(duringSubmit.events.map((entry) => (entry as { type: string }).type)).not.toContain(
      'tool.completed',
    );
  });

  it('rechecks epochs between steering acknowledgement and application', async () => {
    let checks = 0;
    const { events, service } = harness({
      currentEpochs: () => {
        checks += 1;
        return checks < 5 ? epochs : { ...epochs, workspace: 99 };
      },
    });
    await service.start(start);
    const message = {
      schemaVersion: '2.0' as const,
      steeringId: 'steering-id-0001',
      runId: start.runId,
      sequence: 0,
      idempotencyKey: 'steering-key-0001',
      message: 'Apply safely.',
      epochs,
      receivedAt: '2026-08-02T08:00:00.000Z',
    };
    service.receiveSteering(message);

    expect(() => service.applySteering(message.steeringId, 'model-turn-boundary')).toThrow(
      /epoch/i,
    );
    expect(events.map((entry) => (entry as { type: string }).type)).toContain(
      'run.steering.received',
    );
    expect(events.map((entry) => (entry as { type: string }).type)).not.toContain(
      'run.steering.applied',
    );
  });

  it('keeps exact steering replays inert and projects rejected foreign steering safely', async () => {
    const { events, service } = harness();
    await service.start(start);
    const message = {
      schemaVersion: '2.0' as const,
      steeringId: 'steering-id-0001',
      runId: start.runId,
      sequence: 0,
      idempotencyKey: 'steering-key-0001',
      message: 'Apply safely.',
      epochs,
      receivedAt: '2026-08-02T08:00:00.000Z',
    };
    const received = service.receiveSteering(message);
    expect(service.receiveSteering(message)).toBe(received);
    const applied = service.applySteering(message.steeringId, 'model-turn-boundary');
    expect(service.applySteering(message.steeringId, 'model-turn-boundary')).toBe(applied);

    const rejected = service.receiveSteering({
      ...message,
      idempotencyKey: 'steering-key-0002',
      message: 'Foreign.',
      runId: 'run_01K22222222222222222222222',
      sequence: 1,
      steeringId: 'steering-id-0002',
    });
    expect(rejected.entries.at(-1)).toMatchObject({
      rejectionReason: 'stale-epochs',
      status: 'rejected',
    });
    expect(events.map((entry) => (entry as { type: string }).type)).toEqual([
      'run.created',
      'run.steering.received',
      'run.steering.applied',
      'run.steering.rejected',
    ]);
  });

  it('does not submit or publish a result after the in-flight wall-clock deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const events: unknown[] = [];
      const submitted: unknown[] = [];
      const service = new RuntimeRunService({
        clock: { now: () => Date.now() },
        currentEpochs: () => epochs,
        eventSink: { publishBatch: (batch) => events.push(...batch) },
        executor: { execute: async () => new Promise(() => undefined) },
        policy: {
          evaluate: async () => ({ code: 'ALLOW', decision: 'allow', message: 'Allowed.' }),
        },
        receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
        transport: {
          cancel: async () => undefined,
          start: async (input) => ({ runId: input.runId }),
          submitResult: async (_runId, result) => {
            submitted.push(result);
          },
        },
      });
      await service.start({ ...start, budget: { ...start.budget, maxRuntimeMs: 1_000 } });
      const pending = service.dispatch(invocation, { action: 'final' });
      const rejection = expect(pending).rejects.toThrow(/wall-clock/i);

      await vi.advanceTimersByTimeAsync(1_001);

      await rejection;
      expect(submitted).toEqual([]);
      expect(events.map((entry) => (entry as { type: string }).type).slice(-1)).toEqual([
        'run.budget.updated',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the starting reservation after transport rejection and isolates completed replay', async () => {
    let attempts = 0;
    const events: unknown[] = [];
    const service = new RuntimeRunService({
      clock: { now: () => 1_000 },
      currentEpochs: () => epochs,
      eventSink: { publishBatch: (batch) => events.push(...batch) },
      executor: new SafeRuntimeFixtureExecutor({ documentCount: 3, workspaceLabel: 'Fixture' }),
      policy: {
        evaluate: async () => ({ code: 'ALLOW', decision: 'allow', message: 'Allowed.' }),
      },
      receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
      transport: {
        cancel: async () => undefined,
        start: async (input) => {
          attempts += 1;
          if (attempts === 1) throw new Error('admission unavailable');
          return { runId: input.runId };
        },
        submitResult: async () => undefined,
      },
    });
    await expect(service.start(start)).rejects.toThrow(/admission unavailable/i);
    await service.start(start);
    await service.dispatch(invocation, { action: 'final' });

    await expect(
      service.dispatch(
        { ...invocation, invocationId: 'inv_01K22222222222222222222222' },
        {
          action: 'final',
        },
      ),
    ).rejects.toThrow(/no runtime run/i);
    await expect(
      service.dispatch(
        { ...invocation, runId: 'run_01K22222222222222222222222' },
        {
          action: 'final',
        },
      ),
    ).rejects.toThrow(/no runtime run/i);
    expect(events[0]).toMatchObject({ sequence: 0, type: 'run.created' });
  });

  it('uses a fresh authoritative server identifier for each admitted run', async () => {
    let attempts = 0;
    const service = new RuntimeRunService({
      clock: { now: () => 1_000 },
      currentEpochs: () => epochs,
      eventSink: { publishBatch: () => undefined },
      executor: new SafeRuntimeFixtureExecutor({ documentCount: 3, workspaceLabel: 'Fixture' }),
      policy: {
        evaluate: async () => ({ code: 'ALLOW', decision: 'allow', message: 'Allowed.' }),
      },
      receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
      transport: {
        cancel: async () => undefined,
        start: async (_input) => {
          attempts += 1;
          return { runId: `run-id-server-${String(attempts)}` };
        },
        submitResult: async () => undefined,
      },
    });

    await expect(service.start(start)).resolves.toEqual({ runId: 'run-id-server-1' });
    await service.cancel();
    await expect(service.start(start)).resolves.toEqual({ runId: 'run-id-server-2' });
  });
});
