import { describe, expect, it } from 'vitest';

import {
  admitRuntimeInvocation,
  createRuntimeInvocationRegistry,
} from '../../src/core/runtime/runtime-invocation-registry';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition = {
  schemaVersion: '2.0',
  name: 'workspace.context',
  version: '1.0',
  description: 'Read bounded admitted workspace context.',
  operations: ['read'],
  riskClasses: ['inspect'],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['section'],
    properties: {
      section: { type: 'string', enum: ['architecture', 'tests'] },
      limits: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: { type: 'integer', minimum: 1, maximum: 20 },
          tags: { type: 'array', items: { type: 'string', maxLength: 20 }, maxItems: 3 },
        },
      },
    },
  },
} as const;
const invocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: definition.name,
  toolVersion: definition.version,
  operation: 'read',
  arguments: { section: 'architecture', limits: { files: 5, tags: ['api'] } },
  targetId: 'target:primary',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
} as const;

function registry() {
  return createRuntimeInvocationRegistry({
    runId: invocation.runId,
    turnId: invocation.turnId,
    epochs,
    definitions: [definition],
  });
}

/**
 * Redis 7.4's Lua cjson cannot represent an empty array — `[]` and `{}` both
 * decode to a table with no entries, so `cjson.encode` writes `{}` for either.
 * Every runtime.agents argument is decoded and re-encoded inside the backend's
 * Lua state machine, so a graph admitted with an empty `integrationSeams`
 * array arrived HERE, at admission-time validation, as `{}` — the earliest of
 * three gates the value passes through, so it rejected the call before the
 * tolerant schema in multi-agent-dag.ts ever got a chance to run. A hand-built
 * two-task graph with zero write-set collisions still failed with
 * "$.graph.tasks[0].integrationSeams must be an array" until this gate learned
 * the same tolerance.
 */
describe('admitRuntimeInvocation empty-array tolerance', () => {
  it('accepts an empty object where an array-typed argument is expected', () => {
    const admission = admitRuntimeInvocation(registry(), {
      ...invocation,
      arguments: { section: 'architecture', limits: { files: 5, tags: {} } },
    });

    expect(admission.rejection).toBeUndefined();
  });

  it('still rejects a populated object in an array-typed slot', () => {
    // Only the empty case is ambiguous with cjson's round trip. A populated
    // object is not what an empty array becomes, so it must still fail.
    const admission = admitRuntimeInvocation(registry(), {
      ...invocation,
      arguments: { section: 'architecture', limits: { files: 5, tags: { 0: 'api' } } },
    });

    expect(admission.rejection).toBeDefined();
  });

  it('still rejects a non-empty non-array value, like a string', () => {
    const admission = admitRuntimeInvocation(registry(), {
      ...invocation,
      arguments: { section: 'architecture', limits: { files: 5, tags: 'api' } },
    });

    expect(admission.rejection).toBeDefined();
  });
});
