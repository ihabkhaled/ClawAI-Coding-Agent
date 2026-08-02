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

describe('runtime event reducer bounds', () => {
  it('requires a started event before accepting tool completion', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
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
        event(2, 'tool.completed', {
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
  });

  it('evicts the oldest terminal turn at the model-turn cap and protects streaming turns', () => {
    const limits = {
      maxModelTurns: 2,
      maxOutputBytes: 4_096,
      maxRepairAttempts: 1,
      maxRuntimeMs: 10_000,
      maxToolCalls: 2,
      maxToolResultBytes: 2_048,
      maxToolRounds: 2,
    };
    const usage = {
      modelTurns: 0,
      outputBytes: 0,
      repairAttempts: 0,
      toolCalls: 0,
      toolResultBytes: 0,
      toolRounds: 0,
    };
    let snapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    snapshot = reduceRuntimeEvent(snapshot, event(1, 'run.budget.updated', { limits, usage }));
    for (let index = 1; index <= 2; index += 1) {
      const turnId = `turn-id-000${String(index)}`;
      const startSequence = index * 2;
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(startSequence, 'model.turn.started', { turnId }, { turnId }),
      );
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(
          startSequence + 1,
          'model.summary',
          { summary: `Turn ${String(index)}.`, turnId },
          { turnId },
        ),
      );
    }
    const thirdTurnId = 'turn-id-0003';
    snapshot = reduceRuntimeEvent(
      snapshot,
      event(6, 'model.turn.started', { turnId: thirdTurnId }, { turnId: thirdTurnId }),
    );
    expect(Object.keys(snapshot.runs['run-id-0001']?.turns ?? {})).toEqual([
      'turn-id-0002',
      'turn-id-0003',
    ]);

    let protectedSnapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    protectedSnapshot = reduceRuntimeEvent(
      protectedSnapshot,
      event(1, 'run.budget.updated', { limits, usage }),
    );
    protectedSnapshot = reduceRuntimeEvent(
      protectedSnapshot,
      event(2, 'model.turn.started', { turnId: 'turn-id-1001' }, { turnId: 'turn-id-1001' }),
    );
    protectedSnapshot = reduceRuntimeEvent(
      protectedSnapshot,
      event(3, 'model.turn.started', { turnId: 'turn-id-1002' }, { turnId: 'turn-id-1002' }),
    );
    expect(() =>
      reduceRuntimeEvent(
        protectedSnapshot,
        event(4, 'model.turn.started', { turnId: 'turn-id-1003' }, { turnId: 'turn-id-1003' }),
      ),
    ).toThrow(/turns.*capacity/i);
  });

  it('evicts only the oldest terminal invocation at the admitted tool-call cap', () => {
    const limits = {
      maxModelTurns: 2,
      maxOutputBytes: 4_096,
      maxRepairAttempts: 1,
      maxRuntimeMs: 10_000,
      maxToolCalls: 2,
      maxToolResultBytes: 2_048,
      maxToolRounds: 2,
    };
    const usage = {
      modelTurns: 0,
      outputBytes: 0,
      repairAttempts: 0,
      toolCalls: 0,
      toolResultBytes: 0,
      toolRounds: 0,
    };
    const requested = (sequence: number, invocationId: string) =>
      event(sequence, 'tool.requested', {
        invocationId,
        operation: 'read',
        toolName: 'fixture.workspace-summary',
      });
    const completed = (sequence: number, invocationId: string) =>
      event(sequence, 'tool.completed', {
        invocationId,
        receipt: {
          durationMs: 1,
          outputBytes: 5,
          receiptId: `receipt-${invocationId}`,
          redactionApplied: false,
          truncated: false,
        },
        status: 'succeeded',
      });
    const started = (sequence: number, invocationId: string) =>
      event(sequence, 'tool.started', { invocationId });
    let snapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    snapshot = reduceRuntimeEvent(snapshot, event(1, 'run.budget.updated', { limits, usage }));
    snapshot = reduceRuntimeEvent(snapshot, requested(2, 'invocation-id-0001'));
    snapshot = reduceRuntimeEvent(snapshot, started(3, 'invocation-id-0001'));
    snapshot = reduceRuntimeEvent(snapshot, completed(4, 'invocation-id-0001'));
    snapshot = reduceRuntimeEvent(snapshot, requested(5, 'invocation-id-0002'));
    snapshot = reduceRuntimeEvent(snapshot, started(6, 'invocation-id-0002'));
    snapshot = reduceRuntimeEvent(snapshot, completed(7, 'invocation-id-0002'));
    snapshot = reduceRuntimeEvent(snapshot, requested(8, 'invocation-id-0003'));
    expect(Object.keys(snapshot.runs['run-id-0001']?.invocations ?? {})).toEqual([
      'invocation-id-0002',
      'invocation-id-0003',
    ]);

    let protectedSnapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    protectedSnapshot = reduceRuntimeEvent(
      protectedSnapshot,
      event(1, 'run.budget.updated', { limits, usage }),
    );
    protectedSnapshot = reduceRuntimeEvent(protectedSnapshot, requested(2, 'invocation-id-1001'));
    protectedSnapshot = reduceRuntimeEvent(protectedSnapshot, requested(3, 'invocation-id-1002'));
    expect(() => reduceRuntimeEvent(protectedSnapshot, requested(4, 'invocation-id-1003'))).toThrow(
      /invocations.*capacity/i,
    );
  });

  it('compacts steering terminal entries but refuses to evict received entries', () => {
    let snapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    let eventSequence = 1;
    for (let index = 0; index < 32; index += 1) {
      const steeringId = `steering-id-${String(index).padStart(4, '0')}`;
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(eventSequence, 'run.steering.received', { sequence: index, steeringId }),
      );
      eventSequence += 1;
      if (index === 0) {
        snapshot = reduceRuntimeEvent(
          snapshot,
          event(eventSequence, 'run.steering.applied', { sequence: 0, steeringId }),
        );
        eventSequence += 1;
      }
    }
    snapshot = reduceRuntimeEvent(
      snapshot,
      event(eventSequence, 'run.steering.received', {
        sequence: 32,
        steeringId: 'steering-id-0032',
      }),
    );
    expect(snapshot.runs['run-id-0001']?.steering['steering-id-0000']).toBeUndefined();
    expect(Object.keys(snapshot.runs['run-id-0001']?.steering ?? {})).toHaveLength(32);
    eventSequence += 1;
    snapshot = reduceRuntimeEvent(
      snapshot,
      event(eventSequence, 'run.steering.applied', {
        sequence: 1,
        steeringId: 'steering-id-0001',
      }),
    );
    eventSequence += 1;
    snapshot = reduceRuntimeEvent(
      snapshot,
      event(eventSequence, 'run.steering.received', {
        sequence: 33,
        steeringId: 'steering-id-0033',
      }),
    );
    expect(snapshot.runs['run-id-0001']?.steering['steering-id-0001']).toBeUndefined();
    expect(snapshot.runs['run-id-0001']?.steering['steering-id-0033']).toMatchObject({
      sequence: 33,
      status: 'received',
    });

    let protectedSnapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    for (let index = 0; index < 32; index += 1) {
      protectedSnapshot = reduceRuntimeEvent(
        protectedSnapshot,
        event(index + 1, 'run.steering.received', {
          sequence: index,
          steeringId: `protected-steering-${String(index).padStart(4, '0')}`,
        }),
      );
    }
    expect(() =>
      reduceRuntimeEvent(
        protectedSnapshot,
        event(33, 'run.steering.received', {
          sequence: 32,
          steeringId: 'protected-steering-0032',
        }),
      ),
    ).toThrow(/steering.*capacity/i);
  });

  it('keeps the newest bounded timeline suffix and compacts replay identities in lockstep', () => {
    let snapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      snapshot = reduceRuntimeEvent(snapshot, event(sequence, 'future.progress', { sequence }));
    }
    const run = snapshot.runs['run-id-0001'];
    expect(run?.timeline).toHaveLength(256);
    expect(run?.timeline[0]?.sequence).toBe(45);
    expect(run?.lastSequence).toBe(300);
    expect(snapshot.eventIds['event-id-44']).toBeUndefined();
    expect(Object.keys(snapshot.eventIds)).toHaveLength(256);
    expect(reduceRuntimeEvent(snapshot, event(300, 'future.progress', { sequence: 300 }))).toBe(
      snapshot,
    );
    expect(() =>
      reduceRuntimeEvent(snapshot, event(44, 'future.progress', { sequence: 44 })),
    ).toThrow(/sequence/i);
  });

  it('drops oldest timeline entries until both count and byte limits hold', () => {
    let snapshot = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(sequence, 'future.large', { text: `${String(sequence)}${'x'.repeat(49_999)}` }),
      );
    }
    const timeline = snapshot.runs['run-id-0001']?.timeline ?? [];
    const bytes = new TextEncoder().encode(JSON.stringify(timeline)).byteLength;
    expect(bytes).toBeLessThanOrEqual(524_288);
    expect(timeline.at(-1)?.sequence).toBe(12);
    expect(timeline[0]?.sequence).toBeGreaterThan(0);
    expect(Object.keys(snapshot.eventIds)).toEqual(timeline.map((entry) => entry.eventId));
  });

  it('rejects a single timeline event that cannot fit the byte boundary', () => {
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));

    expect(() =>
      reduceRuntimeEvent(created, event(1, 'future.oversized', { text: 'x'.repeat(524_288) })),
    ).toThrow(/timeline event.*capacity/i);
    expect(created.runs['run-id-0001']?.lastSequence).toBe(0);
  });

  it('evicts the oldest terminal run and its replay identities at the run cap', () => {
    let snapshot = createRuntimeSnapshot();
    for (let index = 0; index < 33; index += 1) {
      const suffix = String(index).padStart(4, '0');
      const runId = `bounded-run-${suffix}`;
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(0, 'run.created', {}, { eventId: `run-created-${suffix}`, runId }),
      );
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(1, 'run.completed', {}, { eventId: `run-completed-${suffix}`, runId }),
      );
    }

    expect(Object.keys(snapshot.runs)).toHaveLength(32);
    expect(snapshot.runs['bounded-run-0000']).toBeUndefined();
    expect(snapshot.eventIds['run-created-0000']).toBeUndefined();
    expect(snapshot.eventIds['run-completed-0000']).toBeUndefined();
    expect(snapshot.runOrder[0]).toBe('bounded-run-0001');
    expect(snapshot.runOrder.at(-1)).toBe('bounded-run-0032');
  });

  it('fails closed at the run cap when every retained run is active', () => {
    let snapshot = createRuntimeSnapshot();
    for (let index = 0; index < 32; index += 1) {
      const suffix = String(index).padStart(4, '0');
      snapshot = reduceRuntimeEvent(
        snapshot,
        event(
          0,
          'run.created',
          {},
          {
            eventId: `active-run-created-${suffix}`,
            runId: `active-run-${suffix}`,
          },
        ),
      );
    }

    expect(() =>
      reduceRuntimeEvent(
        snapshot,
        event(
          0,
          'run.created',
          {},
          {
            eventId: 'active-run-created-0032',
            runId: 'active-run-0032',
          },
        ),
      ),
    ).toThrow(/run collection.*capacity/i);
    expect(Object.keys(snapshot.runs)).toHaveLength(32);
  });
});
