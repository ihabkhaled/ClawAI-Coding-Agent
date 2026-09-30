import { afterEach, describe, expect, it } from 'vitest';

import { sandboxedRunnerExecutor } from '../../src/infrastructure/runner-command-executor';

import type { CommandSandboxBinding } from '../../src/infrastructure/command-launch-plan.types';
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

function binding(decision: CommandSandboxPlan['decision']): CommandSandboxBinding {
  return {
    plan: { settings: { mode: 'off', dockerImage: '', allowNetwork: false }, host, decision },
    workspaceRoot: process.cwd(),
  };
}

const signal = new AbortController().signal;
const secret = 'CLAW_TEST_RUNNER_LEAK';

afterEach(() => {
  delete process.env[secret];
});

describe('sandboxedRunnerExecutor', () => {
  it('runs the command and reports that it was unconfined when the sandbox is off', async () => {
    const execute = sandboxedRunnerExecutor(
      { bind: () => binding({ mechanism: 'none', reason: 'disabled' }) },
      () => process.cwd(),
    );
    const result = await execute(
      process.execPath,
      ['-e', "process.stdout.write('ok')"],
      process.cwd(),
      signal,
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok' });
    expect(result.sandbox).toMatch(/^none: .*off/u);
  });

  it('does not hand the editor environment to the command', async () => {
    process.env[secret] = 'visible';
    const execute = sandboxedRunnerExecutor(
      { bind: () => binding({ mechanism: 'none', reason: 'disabled' }) },
      () => process.cwd(),
    );
    const result = await execute(
      process.execPath,
      ['-e', `process.stdout.write(String(process.env.${secret}))`],
      process.cwd(),
      signal,
    );
    expect(result.stdout).toBe('undefined');
  });

  it('refuses instead of running bare when a required mechanism is missing', async () => {
    const execute = sandboxedRunnerExecutor(
      { bind: () => binding({ mechanism: 'none', reason: 'required-unavailable' }) },
      () => undefined,
    );
    await expect(execute(process.execPath, ['-e', '1'], process.cwd(), signal)).rejects.toThrow(
      'SANDBOX_UNAVAILABLE',
    );
  });

  it('reports a non-zero exit code', async () => {
    const execute = sandboxedRunnerExecutor(
      { bind: () => binding({ mechanism: 'none', reason: 'disabled' }) },
      () => process.cwd(),
    );
    const result = await execute(
      process.execPath,
      ['-e', 'process.exit(3)'],
      process.cwd(),
      signal,
    );
    expect(result.exitCode).toBe(3);
  });
});
