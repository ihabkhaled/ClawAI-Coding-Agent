import { describe, expect, it } from 'vitest';

import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
} from '../../src/core/runtime/runtime-event-reducer';
import {
  parseRuntimeEvent,
  type RuntimeEvent,
} from '../../src/core/runtime/runtime-protocol.schemas';

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return parseRuntimeEvent({
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: 'run-id-0001',
    sequence,
    timestamp: new Date(Date.UTC(2026, 7, 2, 10, 0, sequence)).toISOString(),
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    payload,
    ...overrides,
  });
}

describe('runtime event reducer', () => {
  it('reduces every canonical projection lifecycle without retaining raw tool content', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const turn = reduceRuntimeEvent(
      created,
      event(1, 'model.turn.started', { turnId: 'turn-id-0001' }, { turnId: 'turn-id-0001' }),
    );
    const delta = reduceRuntimeEvent(
      turn,
      event(
        2,
        'model.delta',
        { text: 'hello', turnId: 'turn-id-0001' },
        { turnId: 'turn-id-0001' },
      ),
    );
    const summary = reduceRuntimeEvent(
      delta,
      event(
        3,
        'model.summary',
        { summary: 'Complete.', turnId: 'turn-id-0001' },
        { turnId: 'turn-id-0001' },
      ),
    );
    const requested = reduceRuntimeEvent(
      summary,
      event(4, 'tool.requested', {
        invocationId: 'invocation-id-0001',
        operation: 'read',
        toolName: 'fixture.workspace-summary',
      }),
    );
    const started = reduceRuntimeEvent(
      requested,
      event(5, 'tool.started', { invocationId: 'invocation-id-0001' }),
    );
    const completed = reduceRuntimeEvent(
      started,
      event(6, 'tool.completed', {
        invocationId: 'invocation-id-0001',
        receipt: {
          durationMs: 1,
          outputBytes: 5,
          receiptId: 'receipt-id-0001',
          redactionApplied: false,
          truncated: false,
        },
        status: 'succeeded',
      }),
    );
    const steeringReceived = reduceRuntimeEvent(
      completed,
      event(7, 'run.steering.received', { sequence: 0, steeringId: 'steering-id-0001' }),
    );
    const steeringApplied = reduceRuntimeEvent(
      steeringReceived,
      event(8, 'run.steering.applied', { sequence: 0, steeringId: 'steering-id-0001' }),
    );
    const steeringRejected = reduceRuntimeEvent(
      steeringApplied,
      event(9, 'run.steering.rejected', {
        reason: 'run-terminal',
        sequence: 1,
        steeringId: 'steering-id-0002',
      }),
    );
    const budget = reduceRuntimeEvent(
      steeringRejected,
      event(10, 'run.budget.updated', {
        limits: {
          maxModelTurns: 2,
          maxOutputBytes: 4096,
          maxRepairAttempts: 1,
          maxRuntimeMs: 10_000,
          maxToolCalls: 2,
          maxToolResultBytes: 2048,
          maxToolRounds: 2,
        },
        usage: {
          modelTurns: 1,
          outputBytes: 5,
          repairAttempts: 0,
          toolCalls: 1,
          toolResultBytes: 5,
          toolRounds: 1,
        },
      }),
    );
    const phased = reduceRuntimeEvent(budget, event(11, 'run.phase', { phase: 'finalizing' }));

    expect(phased.runs['run-id-0001']).toMatchObject({
      budget: { usage: { toolCalls: 1 } },
      invocations: { 'invocation-id-0001': { status: 'succeeded' } },
      phase: 'finalizing',
      steering: {
        'steering-id-0001': { status: 'applied' },
        'steering-id-0002': { reason: 'run-terminal', status: 'rejected' },
      },
      turns: { 'turn-id-0001': { status: 'completed', textBytes: 5 } },
    });
    expect(JSON.stringify(phased.runs['run-id-0001']?.invocations)).not.toContain('arguments');
  });

  it('rejects invalid canonical lifecycle ordering and deterministically falls back to another live run', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    expect(() =>
      reduceRuntimeEvent(created, event(1, 'tool.started', { invocationId: 'invocation-id-0001' })),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(
          1,
          'model.summary',
          { summary: 'Impossible.', turnId: 'turn-id-0001' },
          { turnId: 'turn-id-0001' },
        ),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'tool.completed', {
          invocationId: 'invocation-id-0001',
          receipt: {
            durationMs: 1,
            outputBytes: 1,
            receiptId: 'receipt-id-0001',
            redactionApplied: false,
            truncated: false,
          },
          status: 'failed',
        }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'run.steering.applied', { sequence: 0, steeringId: 'steering-id-0001' }),
      ),
    ).toThrow(/invalid payload/i);

    const streaming = reduceRuntimeEvent(
      created,
      event(1, 'model.turn.started', { turnId: 'turn-id-0001' }, { turnId: 'turn-id-0001' }),
    );
    const maxDelta = reduceRuntimeEvent(
      streaming,
      event(
        2,
        'model.delta',
        { text: 'x'.repeat(65_536), turnId: 'turn-id-0001' },
        { turnId: 'turn-id-0001' },
      ),
    );
    expect(() =>
      reduceRuntimeEvent(
        maxDelta,
        event(3, 'model.delta', { text: 'x', turnId: 'turn-id-0001' }, { turnId: 'turn-id-0001' }),
      ),
    ).toThrow(/invalid payload/i);

    const requested = reduceRuntimeEvent(
      created,
      event(1, 'tool.requested', {
        invocationId: 'invocation-id-0001',
        operation: 'read',
        toolName: 'fixture.workspace-summary',
      }),
    );
    expect(() =>
      reduceRuntimeEvent(
        requested,
        event(2, 'tool.requested', {
          invocationId: 'invocation-id-0001',
          operation: 'read',
          toolName: 'fixture.workspace-summary',
        }),
      ),
    ).toThrow(/invalid payload/i);

    const receivedSteering = reduceRuntimeEvent(
      created,
      event(1, 'run.steering.received', { sequence: 0, steeringId: 'steering-id-0001' }),
    );
    expect(() =>
      reduceRuntimeEvent(
        receivedSteering,
        event(2, 'run.steering.received', { sequence: 0, steeringId: 'steering-id-0001' }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'run.steering.received', { sequence: 2, steeringId: 'steering-id-0002' }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        receivedSteering,
        event(2, 'run.steering.received', { sequence: 0, steeringId: 'steering-id-0002' }),
      ),
    ).toThrow(/invalid payload/i);
    const appliedSteering = reduceRuntimeEvent(
      receivedSteering,
      event(2, 'run.steering.applied', { sequence: 0, steeringId: 'steering-id-0001' }),
    );
    expect(() =>
      reduceRuntimeEvent(
        appliedSteering,
        event(3, 'run.steering.rejected', {
          reason: 'run-terminal',
          sequence: 0,
          steeringId: 'steering-id-0001',
        }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        receivedSteering,
        event(2, 'run.steering.applied', { sequence: 1, steeringId: 'steering-id-0001' }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        receivedSteering,
        event(2, 'run.steering.rejected', {
          reason: 'stale-epochs',
          sequence: 1,
          steeringId: 'steering-id-0001',
        }),
      ),
    ).toThrow(/invalid payload/i);

    const second = reduceRuntimeEvent(
      created,
      event(0, 'run.created', {}, { eventId: 'second-event-0', runId: 'run-id-0002' }),
    );
    const closed = reduceRuntimeEvent(
      second,
      event(1, 'run.failed', {}, { eventId: 'second-event-1', runId: 'run-id-0002' }),
    );
    expect(closed.activeRunId).toBe('run-id-0001');

    const third = reduceRuntimeEvent(
      second,
      event(0, 'run.created', {}, { eventId: 'third-event-0', runId: 'run-id-0003' }),
    );
    const activeSecond = reduceRuntimeEvent(
      third,
      event(
        1,
        'run.phase',
        { phase: 'working' },
        { eventId: 'second-event-1', runId: 'run-id-0002' },
      ),
    );
    const terminalSecond = reduceRuntimeEvent(
      activeSecond,
      event(2, 'run.failed', {}, { eventId: 'second-event-2', runId: 'run-id-0002' }),
    );
    expect(terminalSecond.activeRunId).toBe('run-id-0001');
  });

  it('rejects malformed and mismatched known event payloads before publishing state', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));

    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'tool.requested', { invocationId: 'invocation-id-0001' }),
      ),
    ).toThrow(/invalid payload/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(
          1,
          'tool.requested',
          {
            invocationId: 'invocation-id-0001',
            operation: 'read',
            toolName: 'fixture.workspace-summary',
          },
          { correlation: { invocationId: 'invocation-id-other' } },
        ),
      ),
    ).toThrow(/invocation/i);
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'model.turn.started', { turnId: 'turn-id-0001' }, { turnId: 'turn-id-other' }),
      ),
    ).toThrow(/turn/i);
    expect(() =>
      reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created', { ignored: true })),
    ).toThrow(/invalid payload/i);
    expect(() => reduceRuntimeEvent(created, event(1, 'run.completed', { ignored: true }))).toThrow(
      /invalid payload/i,
    );
  });

  it('keeps another running run active when an interleaved run becomes terminal', () => {
    const first = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const second = reduceRuntimeEvent(
      first,
      event(0, 'run.created', {}, { eventId: 'second-event-0', runId: 'run-id-0002' }),
    );
    const firstRunning = reduceRuntimeEvent(second, event(1, 'run.phase', { phase: 'executing' }));
    const closedSecond = reduceRuntimeEvent(
      firstRunning,
      event(1, 'run.completed', {}, { eventId: 'second-event-1', runId: 'run-id-0002' }),
    );

    expect(closedSecond.activeRunId).toBe('run-id-0001');
  });

  it('derives ordered run state without mutating earlier snapshots', () => {
    const empty = createRuntimeSnapshot();
    const created = reduceRuntimeEvent(empty, event(0, 'run.created'));
    const running = reduceRuntimeEvent(created, event(1, 'run.phase', { phase: 'planning' }));

    expect(empty).toEqual({
      activeRunId: undefined,
      capabilityManifest: undefined,
      eventIds: {},
      protocolSelection: {
        mode: 'legacy-v1',
        reason: 'endpoint-unavailable',
        version: '1.0',
      },
      runOrder: [],
      runs: {},
    });
    expect(created.runs['run-id-0001']).toMatchObject({
      status: 'running',
      lastSequence: 0,
      phase: undefined,
    });
    expect(running.runs['run-id-0001']).toMatchObject({
      status: 'running',
      lastSequence: 1,
      phase: 'planning',
    });
  });

  it('normalizes the legacy phase event to the V2 run.phase taxonomy', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const projected = reduceRuntimeEvent(
      created,
      event(1, 'run.phase.changed', { phase: 'planning' }),
    );

    expect(projected.runs['run-id-0001']?.phase).toBe('planning');
    expect(projected.runs['run-id-0001']?.timeline.at(-1)?.type).toBe('run.phase');
  });

  it('treats an identical event replay as idempotent', () => {
    const value = event(0, 'run.created');
    const once = reduceRuntimeEvent(createRuntimeSnapshot(), value);

    expect(reduceRuntimeEvent(once, value)).toBe(once);
  });

  it('rejects a conflicting duplicate event identifier', () => {
    const once = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const conflict = event(1, 'run.phase', { phase: 'coding' }, { eventId: 'event-id-0' });

    expect(() => reduceRuntimeEvent(once, conflict)).toThrow(
      'Runtime event event-id-0 conflicts with an earlier event',
    );
  });

  it.each([
    ['gap', event(2, 'run.phase', { phase: 'coding' })],
    ['out of order', event(0, 'run.phase', { phase: 'coding' }, { eventId: 'event-id-other' })],
  ])('rejects a sequence %s', (_label, nextEvent) => {
    const once = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));

    expect(() => reduceRuntimeEvent(once, nextEvent)).toThrow(
      'Runtime event sequence must advance from 0 to 1 for run run-id-0001',
    );
  });

  it.each([
    ['run.completed', 'completed'],
    ['run.blocked', 'blocked'],
    ['run.failed', 'failed'],
    ['run.cancelled', 'cancelled'],
  ] as const)('derives the %s terminal state', (type, status) => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const terminal = reduceRuntimeEvent(created, event(1, type));

    expect(terminal.runs['run-id-0001']?.status).toBe(status);
    expect(terminal.activeRunId).toBeUndefined();
  });

  it('records a future event as inert timeline data', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const future = reduceRuntimeEvent(created, event(1, 'future.widget.ready', { state: 'new' }));

    expect(future.runs['run-id-0001']).toMatchObject({
      status: 'running',
      lastSequence: 1,
      phase: undefined,
    });
    expect(future.runs['run-id-0001']?.timeline.at(-1)?.type).toBe('future.widget.ready');
  });

  it('rejects events after a run reaches a terminal state', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const completed = reduceRuntimeEvent(created, event(1, 'run.completed'));

    expect(() => reduceRuntimeEvent(completed, event(2, 'future.widget.ready'))).toThrow(
      'Runtime run run-id-0001 is already terminal',
    );
  });

  it.each([
    ['a nonzero first sequence', event(1, 'run.created')],
    ['a non-creation first event', event(0, 'model.turn.started')],
  ])('rejects %s', (_label, firstEvent) => {
    expect(() => reduceRuntimeEvent(createRuntimeSnapshot(), firstEvent)).toThrow();
  });

  it('rejects epoch drift and malformed known-event payloads', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const drifted = event(
      1,
      'model.turn.started',
      {},
      {
        epochs: { account: 1, workspace: 99, target: 3, policy: 4 },
      },
    );

    expect(() => reduceRuntimeEvent(created, drifted)).toThrow(
      'Runtime event epochs changed for run run-id-0001',
    );
    expect(() => reduceRuntimeEvent(created, event(1, 'run.phase', { phase: 42 }))).toThrow(
      'Runtime event run.phase has an invalid payload',
    );
  });

  it('fingerprints nested unknown-event JSON consistently and rejects non-JSON payload values', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const nested = event(1, 'future.created', {
      values: [true, null, 'text', 42, { nested: false }],
    });
    const projected = reduceRuntimeEvent(created, nested);

    expect(reduceRuntimeEvent(projected, nested)).toBe(projected);
    expect(() =>
      reduceRuntimeEvent(created, event(1, 'future.created', { value: Number.NaN })),
    ).toThrow('Runtime event contains a non-finite number');
    expect(() =>
      reduceRuntimeEvent(created, event(1, 'future.created', { value: undefined })),
    ).toThrow('Runtime event contains a non-serializable value');
  });

  it('rejects budget usage beyond limits and regressing budget projections', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const limits = {
      maxModelTurns: 2,
      maxOutputBytes: 1_024,
      maxRepairAttempts: 1,
      maxRuntimeMs: 1_000,
      maxToolCalls: 2,
      maxToolResultBytes: 1_024,
      maxToolRounds: 2,
    };
    const withinLimits = {
      modelTurns: 1,
      outputBytes: 1,
      repairAttempts: 0,
      toolCalls: 1,
      toolResultBytes: 1,
      toolRounds: 1,
    };
    expect(() =>
      reduceRuntimeEvent(
        created,
        event(1, 'run.budget.updated', {
          limits,
          usage: { ...withinLimits, toolCalls: 3 },
        }),
      ),
    ).toThrow(/invalid payload/i);
    const updated = reduceRuntimeEvent(
      created,
      event(1, 'run.budget.updated', { limits, usage: withinLimits }),
    );
    expect(() =>
      reduceRuntimeEvent(
        updated,
        event(2, 'run.budget.updated', {
          limits,
          usage: { ...withinLimits, modelTurns: 0 },
        }),
      ),
    ).toThrow(/invalid payload/i);
  });
});
