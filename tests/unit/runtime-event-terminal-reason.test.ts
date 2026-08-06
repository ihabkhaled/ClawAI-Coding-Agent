import { describe, expect, it } from 'vitest';

import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
} from '../../src/core/runtime/runtime-event-reducer';
import {
  parseRuntimeEvent,
  type RuntimeEvent,
} from '../../src/core/runtime/runtime-protocol.schemas';

function event(sequence: number, type: string, payload: Record<string, unknown>): RuntimeEvent {
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
  });
}

// Terminal events were validated against a strict EMPTY payload. The moment the
// backend began attaching a reason — added precisely so a client could show WHY
// a run died — every failed run was rejected here instead. A run the model
// correctly refused surfaced as "run.failed has an invalid payload" rather than
// the actual cause, which is strictly worse than the silence it replaced.
describe('terminal runtime events carry their reason', () => {
  const created = (): ReturnType<typeof reduceRuntimeEvent> =>
    reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created', {}));
  const reason = { code: 'RUNTIME_TOOL_DENIED', message: 'Path escapes the workspace root.' };

  it('projects the terminal status when a reason is present', () => {
    for (const [type, status] of [
      ['run.failed', 'failed'],
      ['run.blocked', 'blocked'],
      ['run.cancelled', 'cancelled'],
      ['run.completed', 'completed'],
    ] as const) {
      const terminal = reduceRuntimeEvent(created(), event(1, type, { reason }));
      expect(terminal.runs['run-id-0001']?.status).toBe(status);
    }
  });

  it('still accepts a terminal event that carries no reason', () => {
    const terminal = reduceRuntimeEvent(created(), event(1, 'run.completed', {}));

    expect(terminal.runs['run-id-0001']?.status).toBe('completed');
  });

  it('keeps the reason bounded rather than silently widening the contract', () => {
    expect(() =>
      reduceRuntimeEvent(created(), event(1, 'run.failed', { reason, extra: 'nope' })),
    ).toThrow('Runtime event run.failed has an invalid payload');
    expect(() =>
      reduceRuntimeEvent(created(), event(1, 'run.failed', { reason: { code: 'X' } })),
    ).toThrow('Runtime event run.failed has an invalid payload');
    expect(() =>
      reduceRuntimeEvent(created(), event(1, 'run.failed', { reason: { code: '', message: 'm' } })),
    ).toThrow('Runtime event run.failed has an invalid payload');
  });

  it('leaves run.created on the empty payload', () => {
    // run.created is not terminal; accepting a reason there would let a client
    // project an explanation onto a run that has not ended.
    expect(() =>
      reduceRuntimeEvent(createRuntimeSnapshot(), event(0, 'run.created', { reason })),
    ).toThrow('Runtime event run.created has an invalid payload');
  });
});
