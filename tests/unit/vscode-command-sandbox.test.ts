import { describe, expect, it, vi } from 'vitest';

const inspected = vi.hoisted(
  () =>
    new Map<string, { globalValue?: unknown; workspaceValue?: unknown; defaultValue?: unknown }>(),
);

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      inspect: (key: string) => inspected.get(key),
    }),
  },
}));

import { VscodeCommandSandbox } from '../../src/infrastructure/vscode-command-sandbox';

import type { CommandSandboxHost } from '../../src/core/command-sandbox.types';

const host: CommandSandboxHost = {
  platform: 'linux',
  bubblewrap: true,
  sandboxExec: false,
  docker: false,
  homeDirectory: '/home/dev',
  temporaryDirectories: ['/tmp'],
  existingCredentialPaths: [],
};

const settingsRead = () =>
  new VscodeCommandSandbox(() => host).bind('/nonexistent-root').plan.settings;

describe('command sandbox settings', () => {
  it('ignores workspace values so a repository cannot switch the sandbox off', () => {
    inspected.clear();
    inspected.set('commandSandbox.mode', { globalValue: 'auto', workspaceValue: 'off' });
    inspected.set('commandSandbox.allowNetwork', { workspaceValue: true, defaultValue: false });
    inspected.set('commandSandbox.dockerImage', { workspaceValue: 'evil:latest' });
    expect(settingsRead()).toEqual({
      mode: 'auto',
      dockerImage: '',
      allowNetwork: false,
    });
  });

  it('falls back to off for an unknown mode', () => {
    inspected.clear();
    inspected.set('commandSandbox.mode', { globalValue: 'jail' });
    expect(settingsRead().mode).toBe('off');
  });
});

describe('VscodeCommandSandbox', () => {
  it('probes the host once and decides per call', () => {
    inspected.clear();
    inspected.set('commandSandbox.mode', { globalValue: 'auto' });
    const probe = vi.fn(() => host);
    const sandbox = new VscodeCommandSandbox(probe);
    const first = sandbox.bind('/nonexistent-root');
    sandbox.bind('/nonexistent-root');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.plan.decision).toEqual({ mechanism: 'bubblewrap' });
    expect(first.workspaceRoot).toBe('/nonexistent-root');
  });
});
