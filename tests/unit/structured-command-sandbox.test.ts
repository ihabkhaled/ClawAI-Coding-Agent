import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCommandSpec = vi.hoisted(() => vi.fn());
const prepareBackgroundLaunch = vi.hoisted(() => vi.fn());
const resolveExecutable = vi.hoisted(() =>
  vi.fn((executable: string) => Promise.resolve(`/usr/bin/${executable}`)),
);

vi.mock('../../src/infrastructure/bounded-command-runner', () => ({
  runCommandSpec,
  prepareBackgroundLaunch,
  resolveExecutable,
}));

import { StructuredCommandToolExecutor } from '../../src/infrastructure/structured-command-tool-executor';

import type { CommandSandboxPlan } from '../../src/core/command-sandbox.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { CommandSandboxBinding } from '../../src/infrastructure/command-launch-plan.types';

const plan: CommandSandboxPlan = {
  settings: { mode: 'auto', dockerImage: '', allowNetwork: false },
  host: {
    platform: 'linux',
    bubblewrap: true,
    sandboxExec: false,
    docker: false,
    homeDirectory: '/nonexistent-home',
    temporaryDirectories: ['/tmp'],
    existingCredentialPaths: [],
  },
  decision: { mechanism: 'bubblewrap' },
};

function harness() {
  const binding: CommandSandboxBinding = { plan, workspaceRoot: '/nonexistent-root' };
  const bind = vi.fn(() => binding);
  const create = vi.fn(async () => ({ sessionId: 'process:1' }));
  const files = {
    workspaceRootUri: vi.fn(() => ({ fsPath: '/nonexistent-root' })),
    uriFor: vi.fn(async () => ({ fsPath: '/nonexistent-root' })),
  };
  const executor = new StructuredCommandToolExecutor(
    files as never,
    { supervisor: { create } as never, ownerId: () => 'account:1' },
    { bind },
  );
  return { executor, bind, create, binding };
}

function invocation(extra: Record<string, unknown> = {}): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:sandbox',
    runId: 'run:sandbox',
    turnId: 'turn:sandbox',
    toolName: 'workspace.command',
    toolVersion: '2.0.0',
    operation: 'run',
    arguments: {
      executable: 'npm',
      arguments: ['test'],
      cwdRootKey: 'workspace-1',
      cwd: '.',
      timeoutMs: 120_000,
      outputLimitBytes: 524_288,
      expectedEffect: 'test',
      ...extra,
    },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem:sandbox',
    requestedAt: '2026-09-29T10:00:00.000Z',
  };
}

describe('StructuredCommandToolExecutor with a command sandbox', () => {
  beforeEach(() => {
    runCommandSpec.mockReset();
    runCommandSpec.mockResolvedValue({ stdout: 'ok', sandbox: { sandbox: 'bubblewrap' } });
    prepareBackgroundLaunch.mockReset();
    prepareBackgroundLaunch.mockResolvedValue({
      executablePath: '/usr/bin/npm',
      arguments: ['run', 'dev'],
      environment: { PATH: '/usr/bin' },
    });
  });

  it('binds the sandbox to the workspace root and hands it to the runner', async () => {
    const { executor, bind, binding } = harness();
    const output = await executor.execute(invocation());
    expect(bind).toHaveBeenCalledWith('/nonexistent-root');
    expect(runCommandSpec).toHaveBeenCalledWith(
      expect.objectContaining({ executable: 'npm' }),
      '/nonexistent-root',
      undefined,
      {},
      binding,
    );
    expect(output.structured).toMatchObject({ sandbox: { sandbox: 'bubblewrap' } });
  });

  it('confines a background command too, and reports it', async () => {
    const { executor, create } = harness();
    const output = await executor.execute(invocation({ background: true }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/usr/bin/bwrap', cwd: '/nonexistent-root' }),
    );
    expect(output.structured).toMatchObject({ sandbox: { sandbox: 'bubblewrap' } });
  });
});
