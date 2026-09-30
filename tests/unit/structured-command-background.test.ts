import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());
const prepareBackgroundLaunch = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({
  runCommandSpec,
  prepareBackgroundLaunch,
}));

import { StructuredCommandToolExecutor } from '../../src/infrastructure/structured-command-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const receipt = {
  sessionId: 'process:abc-123',
  ownerId: 'account:1',
  runId: 'run:background-1',
  targetId: 'target:workspace',
  pid: 4242,
  executableHash: `sha256:${'a'.repeat(64)}`,
  startedAt: '2026-09-29T10:00:00.000Z',
};

function harness(withBackground = true) {
  const files = {
    workspaceRootUri: vi.fn(),
    uriFor: vi.fn(async () => ({ fsPath: 'D:workspace' })),
  };
  const create = vi.fn(async () => receipt);
  const executor = new StructuredCommandToolExecutor(
    files as never,
    withBackground
      ? {
          supervisor: { create, join: vi.fn(), snapshot: vi.fn(), terminate: vi.fn() },
          ownerId: () => 'account:1',
        }
      : undefined,
  );
  return { executor, create, files };
}

function invocation(extra: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:background',
    runId: 'run:background-1',
    turnId: 'turn:background',
    toolName: 'workspace.command',
    toolVersion: '2.0.0',
    operation: 'run',
    arguments: {
      executable: 'npm',
      arguments: ['run', 'dev'],
      cwdRootKey: 'workspace-1',
      cwd: '.',
      timeoutMs: 120_000,
      outputLimitBytes: 524_288,
      expectedEffect: 'build',
      ...extra,
    },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem:background',
  } as unknown as ToolInvocation;
}

describe('workspace.command background handoff', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
    prepareBackgroundLaunch.mockReset();
    prepareBackgroundLaunch.mockResolvedValue({
      executablePath: 'C:\node\npm.cmd',
      arguments: ['run', 'dev'],
      environment: { PATH: 'C:\node' },
    });
  });

  it('hands the command to the supervisor and returns its receipt without waiting', async () => {
    const { executor, create } = harness();

    const output = await executor.execute(invocation({ background: true }));

    expect(runCommandSpec).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: 'C:\node\npm.cmd',
        arguments: ['run', 'dev'],
        cwd: 'D:workspace',
        environment: { PATH: 'C:\node' },
        ownerId: 'account:1',
        runId: 'run:background-1',
        targetId: 'target:workspace',
      }),
    );
    expect(output.structured).toMatchObject({ background: true, receipt: { pid: 4242 } });
  });

  it('runs in the foreground when background is not requested', async () => {
    runCommandSpec.mockResolvedValue({ stdout: 'ok' });
    const { executor, create } = harness();

    await executor.execute(invocation({}));

    expect(create).not.toHaveBeenCalled();
    expect(runCommandSpec).toHaveBeenCalledOnce();
  });

  it('refuses a background request when the host has no supervisor', async () => {
    const { executor } = harness(false);

    await expect(executor.execute(invocation({ background: true }))).rejects.toThrow(
      'Background commands are not available',
    );
  });

  it('lets a launch refusal (stdin, elevation) surface instead of spawning', async () => {
    prepareBackgroundLaunch.mockRejectedValue(new Error('A background command cannot take stdin'));
    const { executor, create } = harness();

    await expect(executor.execute(invocation({ background: true }))).rejects.toThrow('stdin');
    expect(create).not.toHaveBeenCalled();
  });
});
