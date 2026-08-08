import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({ runCommandSpec }));

import { commandSpecSchema } from '../../src/core/command-spec';
import { StructuredCommandToolExecutor } from '../../src/infrastructure/structured-command-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const successfulCommand = {
  executablePath: 'C:\\Program Files\\nodejs\\npm.cmd',
  executableHash: 'sha256:command',
  stdout: 'ok',
  stderr: '',
  exitCode: 0,
  signal: null,
  startedAt: '2026-08-08T13:16:00.000Z',
  durationMs: 12,
  timedOut: false,
  cancelled: false,
  truncated: false,
};

describe('StructuredCommandToolExecutor target authority', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
    runCommandSpec.mockResolvedValue(successfulCommand);
  });

  it('uses the authoritative envelope target without a nested duplicate', async () => {
    const { executor, files } = commandExecutor();

    await executor.execute(invocation(commandArguments()));

    expect(files.workspaceRootUri).toHaveBeenCalledWith('workspace-1');
    expect(files.uriFor).toHaveBeenCalledWith('workspace-1', '.', 'update');
    expect(runCommandSpec).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'target:workspace' }),
      'D:\\workspace',
      undefined,
    );
  });

  it('overrides a conflicting legacy nested target with the envelope target', async () => {
    const { executor } = commandExecutor();

    await executor.execute(
      invocation({ ...commandArguments(), targetId: 'target:stale-workspace' }),
    );

    expect(runCommandSpec).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'target:workspace' }),
      'D:\\workspace',
      undefined,
    );
  });

  it('enforces the documented expected-effect vocabulary', () => {
    expect(
      commandSpecSchema.safeParse({
        ...commandArguments(),
        targetId: 'target:workspace',
        expectedEffect: 'local-mutation',
      }).success,
    ).toBe(true);
    expect(
      commandSpecSchema.safeParse({
        ...commandArguments(),
        targetId: 'target:workspace',
        expectedEffect: 'Generate context for password reset',
      }).success,
    ).toBe(false);
  });
});

function commandExecutor() {
  const files = {
    workspaceRootUri: vi.fn(),
    uriFor: vi.fn(async () => ({ fsPath: 'D:\\workspace' })),
  };
  return { executor: new StructuredCommandToolExecutor(files as never), files };
}

function commandArguments(): ToolInvocation['arguments'] {
  return {
    executable: 'npm',
    arguments: ['run', 'knowledge:context', '--', '--task=password reset'],
    cwdRootKey: 'workspace-1',
    cwd: '.',
    timeoutMs: 120_000,
    outputLimitBytes: 524_288,
    expectedEffect: 'local-mutation',
  };
}

function invocation(argumentsValue: ToolInvocation['arguments']): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:command-authority',
    runId: 'run:command-authority',
    turnId: 'turn:command-authority',
    toolName: 'workspace.command',
    toolVersion: '2.0.0',
    operation: 'run',
    arguments: argumentsValue,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem:command-authority',
    requestedAt: '2026-08-08T13:16:00.000Z',
  };
}
