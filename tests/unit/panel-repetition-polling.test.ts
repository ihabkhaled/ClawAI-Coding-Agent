import { describe, expect, it, vi } from 'vitest';

import { runtimeRepetitionClass } from '../../src/core/runtime/runtime-repetition';
import { RuntimeToolDispatcher } from '../../src/services/runtime-tool-dispatcher';

import type {
  RuntimeJsonObject,
  ToolDefinition,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const TOOLS = [
  ['process.watch', 'wait'],
  ['process.watch', 'status'],
  ['agent.team', 'status'],
  ['browser.page', 'snapshot'],
  ['http.request', 'get'],
  ['task.plan', 'update'],
] as const;
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

function definition(name: string, operations: readonly string[]): ToolDefinition {
  return {
    schemaVersion: '2.0',
    name,
    version: '1.0',
    description: 'Test tool.',
    operations: [...operations],
    riskClasses: ['inspect'],
    targetIds: ['target:primary'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' } },
    },
  };
}

let counter = 0;
function call(toolName: string, operation: string, args: RuntimeJsonObject = {}): ToolInvocation {
  counter += 1;
  const id = String(counter).padStart(4, '0');
  return {
    schemaVersion: '2.0',
    invocationId: `inv_01JZZZZZZZZZZZZZZZZZZZ${id}`,
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName,
    toolVersion: '1.0',
    operation,
    arguments: args,
    targetId: 'target:primary',
    epochs,
    idempotencyKey: `idem_01JZZZZZZZZZZZZZZZZZZZ${id}`,
    requestedAt: '2026-08-02T08:00:00.000Z',
  };
}

function harness() {
  const execute = vi.fn(async () => ({ structured: { ok: true }, modelText: 'fine' }));
  const evaluate = vi.fn(async () => ({
    decision: 'allow' as const,
    code: 'OK',
    message: 'allowed',
  }));
  let now = 1_000;
  const names = [
    ...new Set([...TOOLS.map(([name]) => name), 'workspace.files', 'workspace.notes']),
  ];
  const dispatcher = new RuntimeToolDispatcher({
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    epochs,
    definitions: names.map((name) =>
      definition(name, [
        ...TOOLS.filter(([tool]) => tool === name).map(([, op]) => op),
        'list',
        'add',
      ]),
    ),
    budget,
    startedAtMs: now,
    currentEpochs: () => epochs,
    policy: { evaluate },
    executor: { execute },
    now: () => {
      now += 10;
      return now;
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  });
  return { dispatcher, execute, evaluate };
}

describe('panel repetition: polling tools are never refused', () => {
  it.each(TOOLS)('%s %s may be polled 20 times with identical arguments', async (tool, op) => {
    const { dispatcher, execute } = harness();
    for (let index = 0; index < 20; index += 1) {
      const result = await dispatcher.dispatch(call(tool, op, { id: 'p1' }), keep);
      expect(result.structured).not.toHaveProperty('repeatedCall');
    }
    expect(execute).toHaveBeenCalledTimes(20);
    expect(() => {
      dispatcher.throwIfStuck();
    }).not.toThrow();
  });

  it('only workspace tools are guarded; notes do not start a new epoch', () => {
    const files = runtimeRepetitionClass({ toolName: 'workspace.files', operation: 'list' });
    const watch = runtimeRepetitionClass({ toolName: 'process.watch', operation: 'wait' });
    const note = runtimeRepetitionClass({ toolName: 'workspace.notes', operation: 'add' });

    expect(files.guarded).toBe(true);
    expect(watch.guarded).toBe(false);
    expect(note.kind).toBe('note');
  });

  it('a note between identical reads does not reset the count', async () => {
    const { dispatcher, execute } = harness();
    const read = () => call('workspace.files', 'list', { path: 'src' });
    await dispatcher.dispatch(read(), keep);
    await dispatcher.dispatch(call('workspace.notes', 'add', { text: 'x' }), keep);
    await dispatcher.dispatch(read(), keep);
    const third = await dispatcher.dispatch(read(), keep);

    expect(third.structured).toMatchObject({ repeatedCall: true });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('a refused third call never reaches the approval policy', async () => {
    const { dispatcher, evaluate } = harness();
    const read = () => call('workspace.files', 'list', { path: 'src' });
    await dispatcher.dispatch(read(), keep);
    await dispatcher.dispatch(read(), keep);
    expect(evaluate).toHaveBeenCalledTimes(2);
    const third = await dispatcher.dispatch(read(), keep);

    expect(third.structured).toMatchObject({ repeatedCall: true, times: 3 });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
