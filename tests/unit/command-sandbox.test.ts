import { describe, expect, it } from 'vitest';

import {
  commandSandboxReport,
  decideCommandSandbox,
  sandboxRefusesCommand,
} from '../../src/core/command-sandbox';

import type {
  CommandSandboxHost,
  CommandSandboxSettings,
} from '../../src/core/command-sandbox.types';

const host = (overrides: Partial<CommandSandboxHost> = {}): CommandSandboxHost => ({
  platform: 'linux',
  bubblewrap: false,
  sandboxExec: false,
  docker: false,
  homeDirectory: '/home/dev',
  temporaryDirectories: ['/tmp'],
  existingCredentialPaths: [],
  ...overrides,
});

const settings = (overrides: Partial<CommandSandboxSettings> = {}): CommandSandboxSettings => ({
  mode: 'auto',
  dockerImage: '',
  allowNetwork: false,
  ...overrides,
});

describe('decideCommandSandbox', () => {
  it('is none/disabled when the mode is off, even on a capable host', () => {
    expect(decideCommandSandbox(settings({ mode: 'off' }), host({ bubblewrap: true }))).toEqual({
      mechanism: 'none',
      reason: 'disabled',
    });
  });

  it('auto picks bubblewrap on Linux and seatbelt on macOS', () => {
    expect(decideCommandSandbox(settings(), host({ bubblewrap: true })).mechanism).toBe(
      'bubblewrap',
    );
    expect(
      decideCommandSandbox(settings(), host({ platform: 'darwin', sandboxExec: true })).mechanism,
    ).toBe('seatbelt');
  });

  it('does not take bwrap on a non-Linux platform', () => {
    expect(
      decideCommandSandbox(settings(), host({ platform: 'darwin', bubblewrap: true })),
    ).toEqual({ mechanism: 'none', reason: 'unavailable' });
  });

  it('auto falls back to docker only when an image is configured', () => {
    const windows = host({ platform: 'win32', docker: true });
    expect(decideCommandSandbox(settings(), windows)).toEqual({
      mechanism: 'none',
      reason: 'unavailable',
    });
    expect(decideCommandSandbox(settings({ dockerImage: 'node:22' }), windows).mechanism).toBe(
      'docker',
    );
    expect(decideCommandSandbox(settings({ dockerImage: '   ' }), windows).mechanism).toBe('none');
  });

  it('a named mechanism the host lacks is required-unavailable, never a downgrade', () => {
    for (const mode of ['bubblewrap', 'seatbelt', 'docker'] as const) {
      const decision = decideCommandSandbox(settings({ mode }), host({ platform: 'win32' }));
      expect(decision).toEqual({ mechanism: 'none', reason: 'required-unavailable' });
      expect(sandboxRefusesCommand(decision)).toBe(true);
    }
    expect(
      decideCommandSandbox(settings({ mode: 'docker', dockerImage: 'x' }), host({ docker: true })),
    ).toEqual({ mechanism: 'docker' });
  });
});

describe('commandSandboxReport', () => {
  it('reports none honestly, with the reason', () => {
    const report = commandSandboxReport({
      settings: settings(),
      host: host(),
      decision: { mechanism: 'none', reason: 'unavailable' },
    });
    expect(report).toMatchObject({ sandbox: 'none', filesystem: 'unconfined', network: 'on' });
    expect(report.detail).toContain('No sandbox mechanism');
    expect(sandboxRefusesCommand({ mechanism: 'none', reason: 'unavailable' })).toBe(false);
  });

  it('reports the network state the settings chose', () => {
    const decision = { mechanism: 'bubblewrap' } as const;
    expect(commandSandboxReport({ settings: settings(), host: host(), decision })).toMatchObject({
      sandbox: 'bubblewrap',
      filesystem: 'workspace',
      network: 'off',
    });
    expect(
      commandSandboxReport({ settings: settings({ allowNetwork: true }), host: host(), decision })
        .network,
    ).toBe('on');
    expect(sandboxRefusesCommand(decision)).toBe(false);
  });
});
