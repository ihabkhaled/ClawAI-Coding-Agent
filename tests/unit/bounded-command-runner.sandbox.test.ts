import { describe, expect, it } from 'vitest';

import { runCommandSpec } from '../../src/infrastructure/bounded-command-runner';

import type { CommandSandboxPlan } from '../../src/core/command-sandbox.types';

const host: CommandSandboxPlan['host'] = {
  platform: process.platform,
  bubblewrap: false,
  sandboxExec: false,
  docker: false,
  homeDirectory: '/nonexistent-home',
  temporaryDirectories: [],
  existingCredentialPaths: [],
};

function commandSpec(): unknown {
  return {
    executable: process.execPath,
    arguments: ['-e', "process.stdout.write('ok')"],
    cwdRootKey: 'workspace-root',
    cwd: '.',
    environment: {},
    timeoutMs: 10_000,
    outputLimitBytes: 4_096,
    expectedEffect: 'read' as const,
    targetId: 'target:workspace',
    elevation: false,
  };
}

describe('runCommandSpec with a sandbox binding', () => {
  it('runs unconfined and says so when the sandbox is off', async () => {
    const result = await runCommandSpec(
      commandSpec(),
      process.cwd(),
      undefined,
      {},
      {
        plan: {
          settings: { mode: 'off', dockerImage: '', allowNetwork: false },
          host,
          decision: { mechanism: 'none', reason: 'disabled' },
        },
        workspaceRoot: process.cwd(),
      },
    );
    expect(result.stdout).toBe('ok');
    expect(result.sandbox).toMatchObject({ sandbox: 'none', filesystem: 'unconfined' });
  });

  it('refuses to run when a required mechanism is missing', async () => {
    await expect(
      runCommandSpec(
        commandSpec(),
        process.cwd(),
        undefined,
        {},
        {
          plan: {
            settings: { mode: 'bubblewrap', dockerImage: '', allowNetwork: false },
            host,
            decision: { mechanism: 'none', reason: 'required-unavailable' },
          },
          workspaceRoot: process.cwd(),
        },
      ),
    ).rejects.toThrow('SANDBOX_UNAVAILABLE');
  });

  it('adds no sandbox field when no binding is given', async () => {
    const result = await runCommandSpec(commandSpec(), process.cwd());
    expect(result.sandbox).toBeUndefined();
  });
});
