import { describe, expect, it, vi } from 'vitest';

import { RuntimeToolDispatcher } from '../../src/services/runtime-tool-dispatcher';

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const definition = {
  schemaVersion: '2.0' as const,
  name: 'workspace.context',
  version: '1.0',
  description: 'Read bounded admitted workspace context.',
  operations: ['read'],
  riskClasses: ['inspect' as const],
  targetIds: ['target:primary'],
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['section'],
    properties: { section: { type: 'string' } },
  },
};
const invocation = {
  schemaVersion: '2.0' as const,
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
  requestedAt: '2026-08-02T08:00:00.000Z',
};
const budget = {
  maxModelTurns: 2,
  maxToolCalls: 1,
  maxToolRounds: 1,
  maxRepairAttempts: 1,
  maxRuntimeMs: 10_000,
  maxOutputBytes: 4_096,
  maxToolResultBytes: 2_048,
};
const continuation = { action: 'final' as const };

function harness(
  overrides: {
    budget?: typeof budget;
    policy?: () => Promise<{ decision: 'allow' | 'deny'; code: string; message: string }>;
    policyDecision?: 'allow' | 'deny';
    currentEpochs?: () => typeof epochs;
    execute?: () => Promise<{ structured: { files: number }; modelText: string }>;
  } = {},
) {
  const policy = vi.fn(
    overrides.policy ??
      (async () => ({
        decision: overrides.policyDecision ?? ('allow' as const),
        code: 'TOOL_POLICY_DENIED',
        message: 'The current policy denied this tool.',
      })),
  );
  const execute = vi.fn(
    overrides.execute ??
      (async () => ({ structured: { files: 3 }, modelText: 'Three files inspected.' })),
  );
  let now = 1_000;
  const dispatcher = new RuntimeToolDispatcher({
    runId: invocation.runId,
    turnId: invocation.turnId,
    epochs,
    definitions: [definition],
    budget: overrides.budget ?? budget,
    startedAtMs: now,
    currentEpochs: overrides.currentEpochs ?? (() => epochs),
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

describe('runtime tool dispatcher', () => {
  it('validates, evaluates policy, executes, and returns one bounded result', async () => {
    const { dispatcher, execute, policy } = harness();
    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result).toMatchObject({ status: 'succeeded', structured: { files: 3 } });
    expect(policy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(dispatcher.snapshot.budget.usage).toMatchObject({ toolCalls: 1, toolRounds: 1 });
  });

  it('returns an exact completed replay without redispatching', async () => {
    const { dispatcher, execute } = harness();
    const first = await dispatcher.dispatch(invocation, continuation);
    const replay = await dispatcher.dispatch(invocation, continuation);

    expect(replay).toBe(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('closes the invocation registry when the final result is terminal', async () => {
    const { dispatcher } = harness();

    await dispatcher.dispatch(invocation, continuation);

    expect(dispatcher.snapshot.lifecycle).toBe('completed');
    expect(dispatcher.snapshot.registry.status).toBe('completed');
  });

  it('rejects a concurrent exact replay before a first result exists', async () => {
    let finish: ((value: { structured: { files: number }; modelText: string }) => void) | undefined;
    const pendingOutput = new Promise<{ structured: { files: number }; modelText: string }>(
      (resolve) => {
        finish = resolve;
      },
    );
    const { dispatcher } = harness({ execute: () => pendingOutput });
    const first = dispatcher.dispatch(invocation, continuation);

    await expect(dispatcher.dispatch(invocation, continuation)).rejects.toThrow(/in progress/i);
    finish?.({ structured: { files: 3 }, modelText: 'Three files inspected.' });
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('cancels another admitted invocation when the first terminalizes and stores both receipts', async () => {
    let completeFirst:
      ((value: { structured: { files: number }; modelText: string }) => void) | undefined;
    let failSecond: ((reason?: unknown) => void) | undefined;
    const firstOutput = new Promise<{ structured: { files: number }; modelText: string }>(
      (resolve) => {
        completeFirst = resolve;
      },
    );
    const secondOutput = new Promise<{ structured: { files: number }; modelText: string }>(
      (_resolve, reject) => {
        failSecond = reject;
      },
    );
    let execution = 0;
    const { dispatcher } = harness({
      budget: { ...budget, maxToolCalls: 2, maxToolRounds: 2 },
      execute: () => {
        execution += 1;
        return execution === 1 ? firstOutput : secondOutput;
      },
    });
    const secondInvocation = {
      ...invocation,
      invocationId: 'inv_01K11111111111111111111111',
      idempotencyKey: 'idem_01K11111111111111111111111',
    };

    const first = dispatcher.dispatch(invocation, continuation);
    const second = dispatcher.dispatch(secondInvocation, continuation);
    await vi.waitFor(() => {
      expect(execution).toBe(2);
    });
    completeFirst?.({ structured: { files: 1 }, modelText: 'First result.' });
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
    failSecond?.(new Error('Second execution failed.'));

    await expect(second).resolves.toMatchObject({ status: 'cancelled' });
    expect(Object.keys(dispatcher.snapshot.results)).toHaveLength(2);
  });

  it('stores a concurrent cancellation receipt after the first result exhausts remaining capacity', async () => {
    let completeFirst:
      ((value: { structured: { files: number }; modelText: string }) => void) | undefined;
    const firstOutput = new Promise<{ structured: { files: number }; modelText: string }>(
      (resolve) => {
        completeFirst = resolve;
      },
    );
    let execution = 0;
    const { dispatcher } = harness({
      budget: {
        ...budget,
        maxOutputBytes: 1_024,
        maxToolCalls: 2,
        maxToolResultBytes: 1_024,
        maxToolRounds: 2,
      },
      execute: () => {
        execution += 1;
        return execution === 1 ? firstOutput : new Promise(() => undefined);
      },
    });
    const secondInvocation = {
      ...invocation,
      invocationId: 'inv_01K22222222222222222222222',
      idempotencyKey: 'idem_01K22222222222222222222222',
    };

    const first = dispatcher.dispatch(invocation, continuation);
    const second = dispatcher.dispatch(secondInvocation, continuation);
    await vi.waitFor(() => {
      expect(execution).toBe(2);
    });
    completeFirst?.({ structured: { files: 1 }, modelText: 'x'.repeat(900) });

    await expect(first).resolves.toMatchObject({ receipt: { truncated: false } });
    await expect(second).resolves.toMatchObject({ status: 'cancelled' });
    expect(Object.keys(dispatcher.snapshot.results)).toHaveLength(2);
  });

  it('denies through policy without calling the executor', async () => {
    const { dispatcher, execute } = harness({ policyDecision: 'deny' });
    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result).toMatchObject({ status: 'denied', error: { code: 'TOOL_POLICY_DENIED' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('tells the model why the executor failed instead of only that it failed', async () => {
    // Seventeen models were screened against this runtime and all seventeen got
    // the same bare "The trusted tool executor failed." for a `workspace.files
    // list` request that was itself valid. The reason was discarded at the catch,
    // so nothing anywhere said what went wrong.
    const { dispatcher } = harness({
      execute: async () => {
        throw new Error('EACCES: permission denied, scandir /workspace');
      },
    });

    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('TOOL_EXECUTION_FAILED');
    expect(result.error?.message).toContain('permission denied');
    expect(result.error?.message).toContain('The trusted tool executor failed');
  });

  it('still says only that it failed when the executor gave no message', async () => {
    const { dispatcher } = harness({
      execute: async () => {
        throw new Error('   ');
      },
    });

    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result.error?.message).toBe('The trusted tool executor failed.');
    expect(result.error?.redactionApplied).toBe(false);
  });

  it('keeps a secret out of the reason it now reports', async () => {
    const { dispatcher } = harness({
      execute: async () => {
        throw new Error('refused with Authorization: Bearer executor-secret-value');
      },
    });

    const result = await dispatcher.dispatch(invocation, continuation);

    expect(JSON.stringify(result)).not.toContain('executor-secret-value');
    expect(result.error?.redactionApplied).toBe(true);
  });

  it('stays active after a failed step when the loop says continue, so the model can react', async () => {
    // The failed result reaches the model with its reason, but the registry
    // used to close as `failed` regardless of the continuation. The model's
    // recovery turn then found a terminal registry: beginModelTurn threw
    // RuntimeRunEndedError, the stream stopped following, and the coordinator
    // cancelled a run the backend was still executing — the error was surfaced
    // and then the one turn that could act on it was dropped.
    let execution = 0;
    const { dispatcher } = harness({
      budget: { ...budget, maxModelTurns: 4, maxToolCalls: 2, maxToolRounds: 2 },
      execute: () => {
        execution += 1;
        return execution === 1
          ? Promise.reject(new Error('ENOENT: workspace root /foo/bar does not exist'))
          : Promise.resolve({ structured: { files: 3 }, modelText: 'Three files inspected.' });
      },
    });

    const failed = await dispatcher.dispatch(invocation, {
      action: 'continue',
      nextTurnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZY',
    });

    expect(failed.status).toBe('failed');
    expect(dispatcher.snapshot.lifecycle).toBe('active');
    expect(dispatcher.snapshot.registry.status).toBe('active');

    dispatcher.recordModelLifecycle(false, 'turn_01JZZZZZZZZZZZZZZZZZZZZZY');
    const recovered = await dispatcher.dispatch(
      {
        ...invocation,
        invocationId: 'inv_01K33333333333333333333333',
        idempotencyKey: 'idem_01K33333333333333333333333',
        turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZY',
      },
      continuation,
    );

    expect(recovered.status).toBe('succeeded');
    expect(dispatcher.snapshot.lifecycle).toBe('completed');
  });

  it('still ends as failed when a step fails on a final continuation', async () => {
    const { dispatcher } = harness({
      execute: async () => {
        throw new Error('fixture is unavailable');
      },
    });

    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result.status).toBe('failed');
    expect(dispatcher.snapshot.lifecycle).toBe('failed');
    expect(dispatcher.snapshot.registry.status).toBe('failed');
  });

  it('converts a policy failure into a safe replayable terminal result', async () => {
    const { dispatcher, execute } = harness({
      policy: async () => {
        throw new Error('Bearer policy-secret');
      },
    });

    const first = await dispatcher.dispatch(invocation, continuation);
    const replay = await dispatcher.dispatch(invocation, continuation);

    expect(first).toMatchObject({ status: 'failed', error: { code: 'TOOL_EXECUTION_FAILED' } });
    expect(replay).toBe(first);
    expect(dispatcher.snapshot.lifecycle).toBe('failed');
    expect(dispatcher.snapshot.registry.status).toBe('failed');
    expect(JSON.stringify(first)).not.toContain('policy-secret');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects unknown or invalid invocations before policy or effects', async () => {
    const { dispatcher, execute, policy } = harness();
    await expect(
      dispatcher.dispatch({ ...invocation, arguments: { unexpected: true } }, continuation),
    ).rejects.toThrow(/arguments/i);
    expect(policy).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('checks current epochs again before returning an executor result', async () => {
    let checks = 0;
    const { dispatcher } = harness({
      currentEpochs: () => {
        checks += 1;
        return checks < 3 ? epochs : { ...epochs, workspace: 99 };
      },
    });
    await expect(dispatcher.dispatch(invocation, continuation)).rejects.toThrow(/epoch/i);
    expect(dispatcher.snapshot.results).toEqual({});
  });

  it('does not publish a late result after cancellation', async () => {
    let finish: ((value: { structured: { files: number }; modelText: string }) => void) | undefined;
    const execution = new Promise<{ structured: { files: number }; modelText: string }>(
      (resolve) => {
        finish = resolve;
      },
    );
    const { dispatcher } = harness({ execute: () => execution });
    const controller = new AbortController();
    const pending = dispatcher.dispatch(invocation, continuation, controller.signal);
    controller.abort(new Error('cancelled'));
    finish?.({ structured: { files: 3 }, modelText: 'late output' });

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    expect(dispatcher.snapshot.lifecycle).toBe('cancelled');
  });

  it('debits a repair turn and emits a timed-out result at the runtime deadline', async () => {
    vi.useFakeTimers();
    try {
      const { dispatcher } = harness({
        budget: { ...budget, maxRuntimeMs: 1_000 },
        execute: () => new Promise(() => undefined),
      });
      const pending = dispatcher.dispatch(invocation, { action: 'repair', repairAttempt: 1 });

      await vi.advanceTimersByTimeAsync(1_001);

      await expect(pending).resolves.toMatchObject({
        status: 'timed-out',
        error: { code: 'TOOL_TIMED_OUT' },
      });
      expect(dispatcher.snapshot.budget.usage).toMatchObject({
        modelTurns: 1,
        repairAttempts: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('denies an already-aborted signal before admission or effects', async () => {
    const { dispatcher, execute, policy } = harness();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(dispatcher.dispatch(invocation, continuation, controller.signal)).rejects.toThrow(
      /cancelled/i,
    );
    expect(policy).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('converts executor failures to a safe redacted terminal error', async () => {
    const { dispatcher } = harness({
      execute: async () => {
        throw new Error('Bearer sensitive-token');
      },
    });
    const result = await dispatcher.dispatch(invocation, continuation);

    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'TOOL_EXECUTION_FAILED', retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain('sensitive-token');
  });

  it('rolls back registry and budget admission when the lifecycle observer fails', async () => {
    const { dispatcher, execute, policy } = harness();

    await expect(
      dispatcher.dispatch(invocation, continuation, undefined, {
        onInvocationAdmitted: () => {
          throw new Error('event sink unavailable');
        },
      }),
    ).rejects.toThrow(/event sink unavailable/i);

    expect(dispatcher.snapshot.budget.usage).toMatchObject({ toolCalls: 0, toolRounds: 0 });
    expect(dispatcher.snapshot.registry.invocations).toEqual({});
    await expect(dispatcher.dispatch(invocation, continuation)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(policy).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
