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
    timestamp: `2026-08-02T10:00:0${String(sequence)}.000Z`,
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    payload,
    ...overrides,
  });
}

describe('runtime event reducer', () => {
  it('derives ordered run state without mutating earlier snapshots', () => {
    const empty = createRuntimeSnapshot();
    const created = reduceRuntimeEvent(empty, event(0, 'run.created'));
    const running = reduceRuntimeEvent(
      created,
      event(1, 'run.phase.changed', { phase: 'planning' }),
    );

    expect(empty).toEqual({ activeRunId: undefined, eventIds: {}, runs: {} });
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
    expect(running.runs['run-id-0001']?.timeline).toHaveLength(2);
  });

  it('treats an identical event replay as idempotent', () => {
    const value = event(0, 'run.created');
    const once = reduceRuntimeEvent(createRuntimeSnapshot(), value);

    expect(reduceRuntimeEvent(once, value)).toBe(once);
  });

  it('rejects a conflicting duplicate event identifier', () => {
    const once = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const conflict = event(1, 'run.phase.changed', { phase: 'coding' }, { eventId: 'event-id-0' });

    expect(() => reduceRuntimeEvent(once, conflict)).toThrow(
      'Runtime event event-id-0 conflicts with an earlier event',
    );
  });

  it.each([
    ['gap', event(2, 'run.phase.changed', { phase: 'coding' })],
    [
      'out of order',
      event(0, 'run.phase.changed', { phase: 'coding' }, { eventId: 'event-id-other' }),
    ],
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

  it('tracks interleaved runs independently while enforcing global event identifiers', () => {
    const firstRun = reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created'));
    const secondRunCreated = event(
      0,
      'run.created',
      {},
      {
        eventId: 'second-event-0',
        runId: 'run-id-0002',
      },
    );
    const interleaved = reduceRuntimeEvent(firstRun, secondRunCreated);
    const firstRunAdvanced = reduceRuntimeEvent(interleaved, event(1, 'model.turn.started'));

    expect(firstRunAdvanced.runs['run-id-0001']?.lastSequence).toBe(1);
    expect(firstRunAdvanced.runs['run-id-0002']?.lastSequence).toBe(0);
    expect(() =>
      reduceRuntimeEvent(
        firstRunAdvanced,
        event(
          1,
          'model.turn.started',
          {},
          {
            eventId: 'event-id-0',
            runId: 'run-id-0002',
          },
        ),
      ),
    ).toThrow('Runtime event event-id-0 conflicts with an earlier event');
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
    expect(() => reduceRuntimeEvent(created, event(1, 'run.phase.changed', { phase: 42 }))).toThrow(
      'Runtime event run.phase.changed has an invalid payload',
    );
  });

  it('fingerprints nested JSON consistently and rejects non-JSON payload values', () => {
    const nested = event(0, 'run.created', {
      values: [true, null, 'text', 42, { nested: false }],
    });
    const created = reduceRuntimeEvent(createRuntimeSnapshot(), nested);

    expect(reduceRuntimeEvent(created, nested)).toBe(created);
    expect(() =>
      reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created', { value: Number.NaN })),
    ).toThrow('Runtime event contains a non-finite number');
    expect(() =>
      reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created', { value: undefined })),
    ).toThrow('Runtime event contains a non-serializable value');
  });
});
