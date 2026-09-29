import { describe, expect, it, vi } from 'vitest';

import { planCommandLaunch } from '../../src/infrastructure/command-launch-plan';

import type { CommandSandboxHost, CommandSandboxPlan } from '../../src/core/command-sandbox.types';
import type { CommandLaunchInput } from '../../src/infrastructure/command-launch-plan.types';

const host: CommandSandboxHost = {
  platform: 'linux',
  bubblewrap: true,
  sandboxExec: false,
  docker: true,
  homeDirectory: '/home/dev',
  temporaryDirectories: ['/tmp'],
  existingCredentialPaths: [],
};

const base: CommandLaunchInput = {
  executable: 'npm',
  arguments: ['test'],
  cwd: '/w',
  environment: {},
  declaredEnvironment: {},
};

const resolver = () => vi.fn((executable: string) => Promise.resolve(`/usr/bin/${executable}`));

const bound = (plan: Omit<CommandSandboxPlan, 'host'>): CommandLaunchInput => ({
  ...base,
  sandbox: { plan: { ...plan, host }, workspaceRoot: '/w' },
});

describe('planCommandLaunch', () => {
  it('without a binding spawns the resolved executable and reports nothing', async () => {
    const launch = await planCommandLaunch(base, resolver());
    expect(launch).toEqual({
      executablePath: '/usr/bin/npm',
      spawnPath: '/usr/bin/npm',
      spawnArguments: ['test'],
    });
  });

  it('reports sandbox none when the mode is off', async () => {
    const launch = await planCommandLaunch(
      bound({
        settings: { mode: 'off', dockerImage: '', allowNetwork: false },
        decision: { mechanism: 'none', reason: 'disabled' },
      }),
      resolver(),
    );
    expect(launch.spawnPath).toBe('/usr/bin/npm');
    expect(launch.sandbox?.sandbox).toBe('none');
  });

  it('refuses when a required mechanism is unavailable', async () => {
    await expect(
      planCommandLaunch(
        bound({
          settings: { mode: 'seatbelt', dockerImage: '', allowNetwork: false },
          decision: { mechanism: 'none', reason: 'required-unavailable' },
        }),
        resolver(),
      ),
    ).rejects.toThrow('SANDBOX_UNAVAILABLE');
  });

  it('wraps in bubblewrap around the host-resolved executable', async () => {
    const launch = await planCommandLaunch(
      bound({
        settings: { mode: 'auto', dockerImage: '', allowNetwork: false },
        decision: { mechanism: 'bubblewrap' },
      }),
      resolver(),
    );
    expect(launch.spawnPath).toBe('/usr/bin/bwrap');
    expect(launch.executablePath).toBe('/usr/bin/npm');
    expect(launch.spawnArguments.slice(-3)).toEqual(['--', '/usr/bin/npm', 'test']);
    expect(launch.sandbox).toMatchObject({ sandbox: 'bubblewrap', network: 'off' });
  });

  it('does not resolve the inner executable on the host in docker mode', async () => {
    const resolve = resolver();
    const launch = await planCommandLaunch(
      bound({
        settings: { mode: 'docker', dockerImage: 'node:22', allowNetwork: false },
        decision: { mechanism: 'docker' },
      }),
      resolve,
    );
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('docker', {});
    expect(launch.executablePath).toBe('/usr/bin/docker');
    expect(launch.spawnArguments.slice(-3)).toEqual(['node:22', 'npm', 'test']);
  });
});
