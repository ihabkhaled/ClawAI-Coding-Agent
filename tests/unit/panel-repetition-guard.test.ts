import { describe, expect, it, vi } from 'vitest';

import { RuntimeStuckError } from '../../src/core/runtime/runtime-repetition';
import { RuntimeToolDispatcher } from '../../src/services/runtime-tool-dispatcher';

import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition = {
  schemaVersion: '2.0' as const,
  name: 'workspace.files',
  version: '1.0',
  description: 'Files in the workspace.',
  operations: ['list', 'create'],
  riskClasses: ['inspect' as const],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: { path: { type: 'string' } },
  },
};
const budget = {
  maxModelTurns: 100,
  maxToolCalls: 100,
  maxToolRounds: 100,
  maxRepairAttempts: 1,
  maxRuntimeMs: 60_000,
  maxOutputBytes: 1_000_000,
  maxToolResultBytes: 1_000_000,
};
const keep = { action: 'continue' as const, nextTurnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZY' };

let counter = 0;
function call(operation: string, args: RuntimeJsonObject): ToolInvocation {
  counter += 1;
  const id = String(counter).padStart(2, '0');
  return {
    schemaVersion: '2.0',
    invocationId: `inv_01JZZZZZZZZZZZZZZZZZZZZZ${id}`,
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: definition.name,
    toolVersion: definition.version,
    operation,
    arguments: args,
    targetId: 'target:primary',
    epochs,
    idempotencyKey: `idem_01JZZZZZZZZZZZZZZZZZZZZZ${id}`,
    requestedAt: '2026-08-02T08:00:00.000Z',
  };
}

function harness(execute: () => Promise<{ structured: { files: number }; modelText: string }>) {
  const run = vi.fn(execute);
  let now = 1_000;
  const dispatcher = new RuntimeToolDispatcher({
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    epochs,
    definitions: [definition],
    budget,
    startedAtMs: now,
    currentEpochs: () => epochs,
    policy: {
      evaluate: async () => ({ decision: 'allow' as const, code: 'OK', message: 'allowed' }),
    },
    executor: { execute: run },
    now: () => {
      now += 10;
      return now;
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  });
  return { dispatcher, run };
}

const ok = async () => ({ structured: { files: 3 }, modelText: 'three files' });
const list = (path = 'src') => call('list', { path });

describe('panel repetition guard', () => {
  it('runs the second identical call and refuses the third with a note', async () => {
    const { dispatcher, run } = harness(ok);
    await dispatcher.dispatch(list(), keep);
    const second = await dispatcher.dispatch(list(), keep);
    const third = await dispatcher.dispatch(list(), keep);

    expect(second.structured).toMatchObject({ files: 3 });
    expect(run).toHaveBeenCalledTimes(2);
    expect(third.status).toBe('succeeded');
    expect(third.structured).toMatchObject({ repeatedCall: true, times: 3 });
    expect(third.structured).toHaveProperty('previousResult');
  });

  it('does not count calls with different arguments', async () => {
    const { dispatcher, run } = harness(ok);
    for (const path of ['a', 'b', 'c', 'd', 'e']) await dispatcher.dispatch(list(path), keep);

    expect(run).toHaveBeenCalledTimes(5);
  });

  it('starts counting again after a change to the workspace', async () => {
    const { dispatcher, run } = harness(ok);
    await dispatcher.dispatch(list(), keep);
    await dispatcher.dispatch(list(), keep);
    await dispatcher.dispatch(call('create', { path: 'x.ts' }), keep);
    const after = await dispatcher.dispatch(list(), keep);

    expect(run).toHaveBeenCalledTimes(4);
    expect(after.structured).toMatchObject({ files: 3 });
  });

  it('ends the run as stuck on the eighth identical call', async () => {
    const { dispatcher, run } = harness(ok);
    for (let index = 0; index < 7; index += 1) await dispatcher.dispatch(list(), keep);

    const eighth = await dispatcher.dispatch(list(), keep);

    expect(eighth.structured).toMatchObject({ repeatedCall: true, times: 8 });
    expect(() => {
      dispatcher.throwIfStuck();
    }).toThrow(RuntimeStuckError);
    expect(() => {
      dispatcher.throwIfStuck();
    }).toThrow(
      expect.objectContaining({
        code: 'RUNTIME_RUN_STUCK',
        info: { tool: 'workspace.files', operation: 'list', times: 8, target: 'src' },
      }),
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps counting when the executor throws, and a failed write does not reset', async () => {
    const { dispatcher, run } = harness(async () => {
      throw new Error('disk full');
    });
    const create = () => call('create', { path: 'x.ts' });
    const first = await dispatcher.dispatch(create(), keep);
    await dispatcher.dispatch(create(), keep);
    const third = await dispatcher.dispatch(create(), keep);

    expect(first.status).toBe('failed');
    expect(run).toHaveBeenCalledTimes(2);
    expect(third.status).toBe('succeeded');
    expect(third.structured).toMatchObject({ repeatedCall: true, times: 3 });
  });
});
