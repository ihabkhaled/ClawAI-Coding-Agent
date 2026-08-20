import { describe, expect, it, vi } from 'vitest';

import { MAX_RUNTIME_JSON_ARRAY_ITEMS } from '../../src/core/runtime/runtime-json-value';
import {
  RuntimeToolDispatcher,
  type RuntimeToolExecutionOutput,
} from '../../src/services/runtime-tool-dispatcher';

import type { ToolDefinition, ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition: ToolDefinition = {
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
    properties: { section: { type: 'string' } },
  },
};
const invocation: ToolInvocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: definition.name,
  toolVersion: definition.version,
  operation: 'read',
  arguments: { section: 'architecture' },
  targetId: 'target:primary',
  epochs,
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-08T16:07:37.239Z',
};
const nextTurnId = 'turn_01K00000000000000000000000';
const continuation = { action: 'continue' as const, nextTurnId };

function dispatcherFor(execute: () => Promise<RuntimeToolExecutionOutput>): RuntimeToolDispatcher {
  let now = 1_000;
  return new RuntimeToolDispatcher({
    runId: invocation.runId,
    turnId: invocation.turnId,
    epochs,
    definitions: [definition],
    budget: {
      maxModelTurns: 4,
      maxToolCalls: 2,
      maxToolRounds: 2,
      maxRepairAttempts: 1,
      maxRuntimeMs: 10_000,
      maxOutputBytes: 262_144,
      maxToolResultBytes: 262_144,
    },
    startedAtMs: now,
    currentEpochs: () => epochs,
    policy: {
      evaluate: async () => ({ decision: 'allow', code: 'ALLOW', message: 'Allowed.' }),
    },
    executor: { execute },
    now: () => {
      now += 10;
      return now;
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  });
}

describe('runtime tool dispatcher output recovery', () => {
  it('stores an oversized adapter result as a replayable failure and permits the next turn', async () => {
    let execution = 0;
    const execute = vi.fn(async (): Promise<RuntimeToolExecutionOutput> => {
      execution += 1;
      return execution === 1
        ? {
            structured: {
              paths: Array.from(
                { length: MAX_RUNTIME_JSON_ARRAY_ITEMS + 1 },
                (_entry, index) => `src/file-${String(index)}.ts`,
              ),
              truncated: false,
            },
          }
        : { structured: { files: 1 }, modelText: 'Recovered.' };
    });
    const dispatcher = dispatcherFor(execute);

    const failed = await dispatcher.dispatch(invocation, continuation);

    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_OUTPUT_INVALID', retryable: false },
      continuation,
    });
    expect(dispatcher.snapshot.results[invocation.invocationId]).toBe(failed);
    expect(dispatcher.snapshot.lifecycle).toBe('active');
    expect(dispatcher.snapshot.registry.status).toBe('active');
    await expect(dispatcher.dispatch(invocation, continuation)).resolves.toBe(failed);
    expect(execute).toHaveBeenCalledTimes(1);

    dispatcher.recordModelLifecycle(false, nextTurnId);
    const recovered = await dispatcher.dispatch(
      {
        ...invocation,
        invocationId: 'inv_01K11111111111111111111111',
        idempotencyKey: 'idem_01K11111111111111111111111',
        turnId: nextTurnId,
      },
      { action: 'final' },
    );

    expect(recovered).toMatchObject({ status: 'succeeded', structured: { files: 1 } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('turns oversized model text into a fixed safe failure before result completion', async () => {
    const rawMarker = 'raw-output-marker';
    const dispatcher = dispatcherFor(async () => ({ modelText: rawMarker.repeat(5_000) }));

    const failed = await dispatcher.dispatch(invocation, continuation);

    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'TOOL_OUTPUT_INVALID',
        message:
          'The trusted tool returned output outside the bounded Runtime V2 contract. ' +
          'Narrow read-only requests; do not repeat mutations automatically.',
        retryable: false,
      },
    });
    expect(JSON.stringify(failed)).not.toContain(rawMarker);
    expect(dispatcher.snapshot.results[invocation.invocationId]).toBe(failed);
    expect(dispatcher.snapshot.lifecycle).toBe('active');
  });
});
