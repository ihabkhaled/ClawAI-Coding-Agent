import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prepareBackgroundLaunch = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({
  runCommandSpec: vi.fn(),
  prepareBackgroundLaunch,
}));

import { commandSpecSchema } from '../../src/core/command-spec';
import { parseToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import { awaitOrYield, boundedTail } from '../../src/infrastructure/command-yield';
import { StructuredCommandToolExecutor } from '../../src/infrastructure/structured-command-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { SupervisedProcessSnapshot } from '../../src/services/process-supervisor-service';

const receipt = {
  sessionId: 'process:yield-1',
  ownerId: 'account:1',
  runId: 'run:yield-000001',
  targetId: 'target:workspace',
  pid: 777,
  executableHash: `sha256:${'b'.repeat(64)}`,
  startedAt: '2026-09-30T10:00:00.000Z',
};

function snapshot(log: string, exited: boolean): SupervisedProcessSnapshot {
  return {
    ...receipt,
    lifecycle: exited ? 'exited' : 'running',
    exitCode: exited ? 0 : null,
    signal: null,
    log,
    logTruncated: false,
    ready: false,
    expectedPorts: [],
    terminalAttached: true,
  };
}

function supervisor(options: { readonly exitsAfterMs?: number; readonly log: string }) {
  let exited = false;
  return {
    create: vi.fn(async () => receipt),
    join: vi.fn(
      () =>
        new Promise<readonly SupervisedProcessSnapshot[]>((resolve) => {
          if (options.exitsAfterMs === undefined) return;
          setTimeout(() => {
            exited = true;
            resolve([snapshot(options.log, true)]);
          }, options.exitsAfterMs);
        }),
    ),
    snapshot: vi.fn(() => snapshot(options.log, exited)),
    terminate: vi.fn(async () => undefined),
  };
}

const baseArguments = {
  executable: 'npm',
  arguments: ['run', 'build'],
  cwdRootKey: 'workspace-1',
  cwd: '.',
  timeoutMs: 120_000,
  outputLimitBytes: 1_024,
  expectedEffect: 'build',
};

function invocation(extra: Record<string, number>): ToolInvocation {
  return parseToolInvocation({
    schemaVersion: '2.0',
    invocationId: 'invocation:yield',
    runId: receipt.runId,
    turnId: 'turn:yield-01',
    toolName: 'workspace.command',
    toolVersion: '2.0.0',
    operation: 'run',
    arguments: { ...baseArguments, ...extra },
    targetId: receipt.targetId,
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem:yield-01',
    requestedAt: '2026-09-30T10:00:00.000Z',
  });
}

const files = () => ({
  workspaceRootUri: vi.fn(() => ({ fsPath: 'D:/workspace' })),
  uriFor: vi.fn(async () => ({ fsPath: 'D:/workspace' })),
});

function executorFor(fake: ReturnType<typeof supervisor>) {
  return new StructuredCommandToolExecutor(files() as never, {
    supervisor: fake,
    ownerId: () => 'account:1',
  });
}

describe('workspace.command yieldAfterMs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    prepareBackgroundLaunch.mockReset();
    prepareBackgroundLaunch.mockResolvedValue({
      executablePath: 'C:/node/npm.cmd',
      arguments: ['run', 'build'],
      environment: { PATH: 'C:/node' },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns partial output and a receipt when the command outlives the window', async () => {
    const fake = supervisor({ log: 'compiling 1/3\n' });
    const pending = executorFor(fake).execute(invocation({ yieldAfterMs: 2_000 }));
    await vi.advanceTimersByTimeAsync(2_000);
    const output = await pending;

    expect(fake.create).toHaveBeenCalledOnce();
    expect(output.structured).toMatchObject({
      yielded: true,
      background: true,
      yieldAfterMs: 2_000,
      output: 'compiling 1/3\n',
      truncated: false,
      receipt: { pid: 777 },
    });
    expect(fake.terminate).not.toHaveBeenCalled();
  });

  it('reports like a foreground run when the command exits inside the window', async () => {
    const fake = supervisor({ exitsAfterMs: 500, log: 'built\n' });
    const pending = executorFor(fake).execute(invocation({ yieldAfterMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(500);
    const output = await pending;

    expect(output.structured).toMatchObject({ yielded: false, exitCode: 0, output: 'built\n' });
    expect(output.structured).not.toHaveProperty('background');
  });

  it('terminates the command when the turn is cancelled before it yields', async () => {
    const fake = supervisor({ log: 'partial' });
    const controller = new AbortController();
    const pending = executorFor(fake).execute(
      invocation({ yieldAfterMs: 5_000 }),
      controller.signal,
    );
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    const output = await pending;

    expect(fake.terminate).toHaveBeenCalledWith(receipt);
    expect(output.structured).toMatchObject({ cancelled: true, yielded: false });
  });

  it('terminates at once when the signal is already aborted', async () => {
    const fake = supervisor({ log: '' });
    const controller = new AbortController();
    controller.abort();
    const output = await awaitOrYield({
      supervisor: fake,
      receipt,
      yieldAfterMs: 5_000,
      outputLimitBytes: 1_024,
      startedAtMs: Date.now(),
      signal: controller.signal,
    });

    expect(fake.terminate).toHaveBeenCalledOnce();
    expect(output.structured).toMatchObject({ cancelled: true });
  });

  it('carries the sandbox report through a yield', async () => {
    const sandbox = {
      sandbox: 'none',
      filesystem: 'unconfined',
      network: 'on',
      detail: 'no sandbox',
    } as const;
    const pending = awaitOrYield({
      supervisor: supervisor({ log: 'x' }),
      receipt,
      yieldAfterMs: 1_000,
      outputLimitBytes: 1_024,
      startedAtMs: Date.now(),
      sandbox,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect((await pending).structured).toMatchObject({ sandbox });
  });

  it('refuses yieldAfterMs without a supervisor', async () => {
    const executor = new StructuredCommandToolExecutor(files() as never);

    await expect(executor.execute(invocation({ yieldAfterMs: 2_000 }))).rejects.toThrow(
      'Background commands are not available',
    );
  });
});

describe('yieldAfterMs bounds', () => {
  const parse = (extra: Record<string, unknown>) =>
    commandSpecSchema.safeParse({ ...baseArguments, targetId: 'target:workspace', ...extra });

  it('accepts a value inside the bounds and below the timeout', () => {
    expect(parse({ yieldAfterMs: 1_000 }).success).toBe(true);
    expect(parse({ yieldAfterMs: 600_000, timeoutMs: 700_000 }).success).toBe(true);
  });

  it('rejects values outside the bounds', () => {
    expect(parse({ yieldAfterMs: 999 }).success).toBe(false);
    expect(parse({ yieldAfterMs: 600_001, timeoutMs: 7_000_000 }).success).toBe(false);
  });

  it('rejects a yield at or past the timeout, and together with background', () => {
    expect(parse({ yieldAfterMs: 120_000 }).success).toBe(false);
    expect(parse({ yieldAfterMs: 2_000, background: true }).success).toBe(false);
  });
});

describe('boundedTail', () => {
  it('keeps the last bytes of a long log and flags truncation', () => {
    expect(boundedTail('abcdef', 3)).toEqual({ output: 'def', truncated: true });
    expect(boundedTail('abc', 3)).toEqual({ output: 'abc', truncated: false });
  });
});
