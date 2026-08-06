import { describe, expect, it, vi } from 'vitest';

import { forwardLocalTerminals } from '../../src/services/runtime-studio-execution';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

function event(sequence: number, type: string): RuntimeEvent {
  return {
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: 'run-id-0001',
    sequence,
    timestamp: '2026-08-06T19:00:00.000Z',
    type,
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    payload: {},
  } as unknown as RuntimeEvent;
}

/**
 * A run stopped by policy ends on this side, and the backend never learns of it,
 * so it never streams a terminal back. Those endings used to be published into a
 * sink that discarded them and the panel reported "The ClawAI run ended without
 * reporting a result" for a run that had stopped exactly as intended.
 *
 * The first attempt at the fix sent them to the reducer as well, and every run
 * then died with "Runtime event sequence must advance from 40 to 41" — the
 * reducer's ledger is the backend's, admitted strictly in sequence, and these
 * carry the run service's own counter. This forwarder takes a panel callback and
 * nothing else, so there is no reducer for it to reach.
 */
describe('forwardLocalTerminals', () => {
  it('passes an ending on to the panel', () => {
    const panel = vi.fn();
    const ended = vi.fn();

    forwardLocalTerminals(panel, ended).publishBatch([event(3, 'run.blocked')]);

    expect(panel).toHaveBeenCalledTimes(1);
    expect(panel.mock.calls[0]?.[0]).toMatchObject({ type: 'run.blocked' });
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('keeps the step trail out, because the backend already streams it', () => {
    const panel = vi.fn();
    const ended = vi.fn();

    forwardLocalTerminals(panel, ended).publishBatch([
      event(1, 'tool.requested'),
      event(2, 'tool.started'),
      event(3, 'run.budget.updated'),
    ]);

    expect(panel).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
  });

  it('forwards every ending in a batch and nothing else', () => {
    const panel = vi.fn();
    const ended = vi.fn();

    forwardLocalTerminals(panel, ended).publishBatch([
      event(1, 'tool.completed'),
      event(2, 'run.cancelled'),
    ]);

    expect(panel).toHaveBeenCalledTimes(1);
    expect(panel.mock.calls[0]?.[0]).toMatchObject({ type: 'run.cancelled' });
  });
});
