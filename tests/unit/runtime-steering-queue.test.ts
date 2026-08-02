import { describe, expect, it } from 'vitest';

import {
  acknowledgeSteering,
  applySteering,
  closeSteeringQueue,
  createSteeringQueue,
  receiveSteering,
} from '../../src/core/runtime/runtime-steering-queue';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };

function message(sequence: number, content = `Steering ${String(sequence)}`) {
  return {
    schemaVersion: '2.0',
    steeringId: `steering-${String(sequence).padStart(4, '0')}`,
    runId: 'run-id-0001',
    sequence,
    idempotencyKey: `steering-idem-${String(sequence).padStart(4, '0')}`,
    message: content,
    epochs,
    receivedAt: `2026-08-02T09:00:0${String(sequence)}.000Z`,
  };
}

describe('runtime steering queue', () => {
  it('receives a strict bounded message without mutating the previous snapshot', () => {
    const empty = createSteeringQueue('run-id-0001', epochs);
    const received = receiveSteering(empty, message(0));

    expect(empty.entries).toEqual([]);
    expect(received.entries).toHaveLength(1);
    expect(received.entries[0]).toMatchObject({ status: 'received', message: message(0) });
    expect(received.nextSequence).toBe(1);
  });

  it('rejects unknown source metadata and oversized messages', () => {
    const empty = createSteeringQueue('run-id-0001', epochs);

    expect(() => receiveSteering(empty, { ...message(0), sourceModel: 'model-a' })).toThrow();
    expect(() => receiveSteering(empty, { ...message(0), message: 'x'.repeat(40_000) })).toThrow(
      /bytes/i,
    );
  });

  it('treats an exact replay as inert', () => {
    const once = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));

    expect(receiveSteering(once, message(0))).toBe(once);
  });

  it('treats retained idempotency and identifier records as exact replays', () => {
    const once = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const idempotencyOnly = { ...once, sequenceFingerprints: {} };
    const identifierOnly = {
      ...once,
      idempotencyFingerprints: {},
      sequenceFingerprints: {},
    };

    expect(receiveSteering(idempotencyOnly, message(0))).toBe(idempotencyOnly);
    expect(receiveSteering(identifierOnly, message(0))).toBe(identifierOnly);
  });

  it('rejects a reused sequence or idempotency key with a different digest', () => {
    const once = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));

    expect(() => receiveSteering(once, message(0, 'Changed'))).toThrow(/sequence.*conflict/i);
    expect(() =>
      receiveSteering(once, { ...message(1), idempotencyKey: message(0).idempotencyKey }),
    ).toThrow(/idempotency.*conflict/i);
    expect(() =>
      receiveSteering(once, { ...message(1), steeringId: message(0).steeringId }),
    ).toThrow(/identifier.*conflict/i);
  });

  it('rejects sequence gaps before adding an entry', () => {
    const empty = createSteeringQueue('run-id-0001', epochs);

    expect(() => receiveSteering(empty, message(1))).toThrow(/sequence.*0/i);
    expect(empty.entries).toEqual([]);
  });

  it('records stale epochs as a visible rejected status without queueing the message', () => {
    const stale = receiveSteering(createSteeringQueue('run-id-0001', epochs), {
      ...message(0),
      epochs: { ...epochs, workspace: 99 },
    });

    expect(stale.entries[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'stale-epochs',
    });
    expect(stale.pending).toEqual([]);
  });

  it.each([
    ['cancelled', 'run-cancelled'],
    ['completed', 'run-terminal'],
    ['failed', 'run-terminal'],
  ] as const)('denies steering for a %s run', (lifecycle, rejectionReason) => {
    const closed = closeSteeringQueue(createSteeringQueue('run-id-0001', epochs), lifecycle);
    const denied = receiveSteering(closed, message(0));

    expect(denied.entries[0]).toMatchObject({ status: 'rejected', rejectionReason });
  });

  it('acknowledges and applies in order only at an explicit safe boundary', () => {
    const first = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const queued = receiveSteering(first, message(1));

    expect(() => acknowledgeSteering(queued, message(1).steeringId, 'model-turn-boundary')).toThrow(
      /order/i,
    );
    expect(() => acknowledgeSteering(queued, message(0).steeringId, 'tool-running')).toThrow(
      /safe boundary/i,
    );

    const acknowledged = acknowledgeSteering(queued, message(0).steeringId, 'model-turn-boundary');
    expect(acknowledged.entries[0]?.status).toBe('acknowledged');
    expect(() => applySteering(acknowledged, message(0).steeringId, 'tool-running')).toThrow(
      /safe boundary/i,
    );

    const applied = applySteering(acknowledged, message(0).steeringId, 'tool-result-boundary');
    expect(applied.entries[0]?.status).toBe('applied');
    expect(applied.pending).toEqual([message(1).steeringId]);
  });

  it('makes repeated acknowledgment and application inert', () => {
    const received = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const acknowledged = acknowledgeSteering(
      received,
      message(0).steeringId,
      'model-turn-boundary',
    );
    const applied = applySteering(acknowledged, message(0).steeringId, 'model-turn-boundary');

    expect(acknowledgeSteering(acknowledged, message(0).steeringId, 'model-turn-boundary')).toBe(
      acknowledged,
    );
    expect(applySteering(applied, message(0).steeringId, 'model-turn-boundary')).toBe(applied);
  });

  it('rejects pending steering visibly when a run becomes terminal', () => {
    const received = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const closed = closeSteeringQueue(received, 'cancelled');

    expect(closed.entries[0]).toMatchObject({
      status: 'rejected',
      rejectionReason: 'run-cancelled',
    });
    expect(closed.pending).toEqual([]);
    expect(() => acknowledgeSteering(closed, message(0).steeringId, 'model-turn-boundary')).toThrow(
      /cancelled/i,
    );
  });

  it('rejects unknown, rejected, and out-of-order state transitions defensively', () => {
    const received = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const rejected = receiveSteering(createSteeringQueue('run-id-0001', epochs), {
      ...message(0),
      runId: 'run-id-stale',
    });
    const acknowledged = acknowledgeSteering(
      received,
      message(0).steeringId,
      'model-turn-boundary',
    );
    const inconsistent = {
      ...acknowledged,
      pending: ['steering-9999', message(0).steeringId],
    };

    expect(() => acknowledgeSteering(received, 'steering-9999', 'model-turn-boundary')).toThrow(
      /unknown/i,
    );
    expect(() =>
      acknowledgeSteering(rejected, message(0).steeringId, 'model-turn-boundary'),
    ).toThrow(/cannot be acknowledged/i);
    expect(() =>
      applySteering(inconsistent, message(0).steeringId, 'tool-result-boundary'),
    ).toThrow(/queue order/i);
    expect(() => applySteering(received, message(0).steeringId, 'tool-result-boundary')).toThrow(
      /acknowledged before application/i,
    );
  });

  it('makes a matching terminal close inert and rejects a conflicting terminal close', () => {
    const completed = closeSteeringQueue(createSteeringQueue('run-id-0001', epochs), 'completed');

    expect(closeSteeringQueue(completed, 'completed')).toBe(completed);
    expect(() => closeSteeringQueue(completed, 'failed')).toThrow(/already completed/i);
  });

  it('preserves an applied steering record when a later close rejects pending work', () => {
    const received = receiveSteering(createSteeringQueue('run-id-0001', epochs), message(0));
    const acknowledged = acknowledgeSteering(
      received,
      message(0).steeringId,
      'model-turn-boundary',
    );
    const applied = applySteering(acknowledged, message(0).steeringId, 'tool-result-boundary');
    const closed = closeSteeringQueue(applied, 'completed');

    expect(closed.entries[0]?.status).toBe('applied');
  });
});
