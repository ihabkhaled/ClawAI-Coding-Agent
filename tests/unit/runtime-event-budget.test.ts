import { expect, it } from 'vitest';

import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
} from '../../src/core/runtime/runtime-event-reducer';
import { parseRuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

const event = (sequence: number, payload: Record<string, unknown> = {}) =>
  parseRuntimeEvent({
    schemaVersion: '2.0',
    eventId: `event-id-${String(sequence)}`,
    runId: 'run-id-0001',
    sequence,
    timestamp: new Date(Date.UTC(2026, 7, 2, 10, 0, sequence)).toISOString(),
    type: sequence === 0 ? 'run.created' : 'run.budget.updated',
    visibility: 'user',
    sensitivity: 'workspace',
    epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
    payload,
  });

it('rejects budget usage beyond limits and regressing budget projections', () => {
  const created = reduceRuntimeEvent(createRuntimeSnapshot(), event(0));
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
    reduceRuntimeEvent(created, event(1, { limits, usage: { ...withinLimits, toolCalls: 3 } })),
  ).toThrow(/invalid payload/i);
  const updated = reduceRuntimeEvent(created, event(1, { limits, usage: withinLimits }));
  expect(() =>
    reduceRuntimeEvent(updated, event(2, { limits, usage: { ...withinLimits, modelTurns: 0 } })),
  ).toThrow(/invalid payload/i);
});
