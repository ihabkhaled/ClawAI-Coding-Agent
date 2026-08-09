import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolDispatcher } from '../../src/services/runtime-tool-dispatcher';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };

// A continue continuation is what keeps the run alive after a failed result.
const CONTINUE = { action: 'continue' as const, nextTurnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZA' };

const definition = {
  schemaVersion: '2.0' as const,
  name: 'workspace.files',
  version: '2.0.0',
  description: 'Mutate bounded workspace files.',
  operations: ['create'],
  riskClasses: ['workspace-write' as const],
  targetIds: ['target:workspace'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'rootKey', 'path', 'content'],
          properties: {
            kind: { type: 'string' },
            rootKey: { type: 'string' },
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
    },
  },
};

const budget = {
  maxModelTurns: 20,
  maxToolCalls: 40,
  maxToolRounds: 20,
  maxRepairAttempts: 1,
  maxRuntimeMs: 10_000,
  maxOutputBytes: 4_096,
  maxToolResultBytes: 2_048,
};

function invocationWith(
  argumentsValue: Record<string, unknown>,
  toolName?: string,
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: toolName ?? definition.name,
    toolVersion: definition.version,
    operation: 'create',
    arguments: argumentsValue,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-08-09T09:00:00.000Z',
  } as ToolInvocation;
}

function harness() {
  const policy = vi.fn(async () => ({
    decision: 'allow' as const,
    code: 'TOOL_POLICY_DENIED',
    message: 'The current policy denied this tool.',
  }));
  const execute = vi.fn(async () => ({ structured: { written: 1 }, modelText: 'Wrote one file.' }));
  let now = 1_000;
  const dispatcher = new RuntimeToolDispatcher({
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    epochs,
    definitions: [definition],
    budget,
    startedAtMs: now,
    currentEpochs: () => epochs,
    policy: { evaluate: policy },
    executor: { execute },
    now: () => {
      now += 100;
      return now;
    },
    receiptId: () => 'receipt_01JZZZZZZZZZZZZZZZZZZZZZ',
  });
  return { dispatcher, execute, policy };
}

// A live mission died here. The model created a file correctly, then named
// `content` at the top level instead of inside `operations[]`. Strict admission
// threw, the throw escaped dispatch, and the coordinator cancelled the run on
// `Tool arguments $.content is not allowed`. The model was never told what was
// wrong, so it never got the chance to fix a one-line shape mistake.
describe('recovering from a tool request the registry refuses', () => {
  it('returns malformed arguments to the model instead of ending the run', async () => {
    const { dispatcher, execute, policy } = harness();

    const result = await dispatcher.dispatch(
      invocationWith({
        operations: [
          { kind: 'create', rootKey: 'workspace-1', path: 'a.ts', content: 'export {};' },
        ],
        content: 'export {};',
      }),
      CONTINUE,
    );

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('TOOL_ARGUMENTS_INVALID');
    expect(result.error?.message).toContain('content');
    // Nothing may run: the request never became a real effect.
    expect(policy).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the run alive so the next turn can reissue the call', async () => {
    const { dispatcher } = harness();

    await dispatcher.dispatch(invocationWith({ operations: [], content: 'x' }), CONTINUE);

    expect(dispatcher.snapshot.lifecycle).toBe('active');
  });

  // Deliberately NOT recoverable. A tool the catalog never advertised means the
  // two sides of the protocol disagree about what exists, which a reworded
  // argument cannot repair, so it stays a thrown protocol failure.
  it('still throws for a tool the catalog never advertised', async () => {
    const { dispatcher, execute } = harness();

    await expect(
      dispatcher.dispatch(
        invocationWith(
          { operations: [{ kind: 'create', rootKey: 'workspace-1', path: 'a.ts', content: 'x' }] },
          'workspace.imagined',
        ),
        CONTINUE,
      ),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('still executes a request whose arguments are valid', async () => {
    const { dispatcher, execute } = harness();

    const result = await dispatcher.dispatch(
      invocationWith({
        operations: [
          { kind: 'create', rootKey: 'workspace-1', path: 'a.ts', content: 'export {};' },
        ],
      }),
      CONTINUE,
    );

    expect(result.status).toBe('succeeded');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
