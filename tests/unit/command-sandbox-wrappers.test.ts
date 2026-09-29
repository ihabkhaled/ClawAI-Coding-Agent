import { describe, expect, it } from 'vitest';

import {
  bubblewrapArguments,
  dockerArguments,
  seatbeltProfile,
  wrapForSandbox,
} from '../../src/core/command-sandbox-wrappers';

import type {
  CommandSandboxHost,
  CommandSandboxLaunch,
  CommandSandboxSettings,
} from '../../src/core/command-sandbox.types';

const linux: CommandSandboxHost = {
  platform: 'linux',
  bubblewrap: true,
  sandboxExec: false,
  docker: true,
  homeDirectory: '/home/dev',
  temporaryDirectories: ['/tmp', '/var/tmp/x'],
  existingCredentialPaths: [
    { path: '/home/dev/.ssh', kind: 'directory' },
    { path: '/home/dev/.npmrc', kind: 'file' },
  ],
};

const launch: CommandSandboxLaunch = {
  executable: '/usr/bin/npm',
  arguments: ['test'],
  cwd: '/home/dev/app/packages/a',
  workspaceRoot: '/home/dev/app',
  declaredEnvironment: { CI: '1' },
};

const settings: CommandSandboxSettings = {
  mode: 'auto',
  dockerImage: ' node:22 ',
  allowNetwork: false,
};

describe('bubblewrapArguments', () => {
  it('mounts root read-only, masks credentials, binds the workspace last and drops network', () => {
    const argv = bubblewrapArguments(launch, linux, false);
    expect(argv.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(argv).toContain('--unshare-all');
    expect(argv).not.toContain('--share-net');
    const ssh = argv.indexOf('/home/dev/.ssh');
    expect(argv[ssh - 1]).toBe('--tmpfs');
    const npmrc = argv.indexOf('/home/dev/.npmrc');
    expect(argv.slice(npmrc - 2, npmrc)).toEqual(['--ro-bind', '/dev/null']);
    const workspace = argv.lastIndexOf('--bind');
    expect(argv.slice(workspace, workspace + 3)).toEqual([
      '--bind',
      '/home/dev/app',
      '/home/dev/app',
    ]);
    expect(workspace).toBeGreaterThan(ssh);
    expect(argv).toContain('/var/tmp/x');
    expect(argv.slice(-5)).toEqual(['--chdir', launch.cwd, '--', '/usr/bin/npm', 'test']);
  });

  it('shares the network only when allowed', () => {
    expect(bubblewrapArguments(launch, linux, true)).toContain('--share-net');
  });
});

describe('seatbeltProfile', () => {
  it('denies by default, hides credentials after the read allow, writes only workspace and temp', () => {
    const profile = seatbeltProfile(launch, { ...linux, platform: 'darwin' }, false);
    const lines = profile.split('\n');
    expect(lines[1]).toBe('(deny default)');
    const readAllow = lines.indexOf('(allow file-read*)');
    const credentialDeny = lines.findIndex((line) =>
      line.startsWith('(deny file-read* file-write*'),
    );
    expect(credentialDeny).toBeGreaterThan(readAllow);
    expect(lines[credentialDeny]).toContain('(subpath "/home/dev/.ssh")');
    expect(profile).toContain('(allow file-write* (subpath "/home/dev/app")');
    expect(profile).not.toContain('(allow network*)');
    expect(seatbeltProfile(launch, linux, true)).toContain('(allow network*)');
  });

  it('escapes quotes and backslashes so a path cannot end the literal', () => {
    const profile = seatbeltProfile({ ...launch, workspaceRoot: '/w/a"b\\c' }, linux, false);
    expect(profile).toContain('(subpath "/w/a\\"b\\\\c")');
  });
});

describe('dockerArguments', () => {
  it('mounts only the workspace with no network, no capabilities and a pid limit', () => {
    expect(dockerArguments(launch, linux, settings)).toEqual([
      'run',
      '--rm',
      '--interactive',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      '512',
      '--mount',
      'type=bind,source=/home/dev/app,target=/workspace',
      '--workdir',
      '/workspace/packages/a',
      '--env',
      'CI=1',
      'node:22',
      '/usr/bin/npm',
      'test',
    ]);
    expect(dockerArguments(launch, linux, { ...settings, allowNetwork: true })).toContain('bridge');
  });

  it('maps a Windows cwd into the container', () => {
    const argv = dockerArguments(
      { ...launch, workspaceRoot: 'D:\\repo', cwd: 'D:\\repo\\src\\lib', executable: 'npm' },
      { ...linux, platform: 'win32' },
      settings,
    );
    expect(argv).toContain('/workspace/src/lib');
    expect(argv).toContain('type=bind,source=D:\\repo,target=/workspace');
  });

  it('uses the workspace root itself as the workdir', () => {
    expect(dockerArguments({ ...launch, cwd: launch.workspaceRoot }, linux, settings)).toContain(
      '/workspace',
    );
  });

  it('refuses a cwd outside the workspace and a comma in the mount path', () => {
    expect(() => dockerArguments({ ...launch, cwd: '/etc' }, linux, settings)).toThrow(
      'SANDBOX_CWD_OUTSIDE_WORKSPACE',
    );
    expect(() =>
      dockerArguments({ ...launch, workspaceRoot: '/a,b', cwd: '/a,b' }, linux, settings),
    ).toThrow('SANDBOX_WORKSPACE_PATH_UNSUPPORTED');
  });
});

describe('wrapForSandbox', () => {
  it('names the helper executable for each mechanism', () => {
    expect(wrapForSandbox('bubblewrap', launch, linux, settings).executable).toBe('bwrap');
    const seatbelt = wrapForSandbox('seatbelt', launch, linux, settings);
    expect(seatbelt.executable).toBe('sandbox-exec');
    expect(seatbelt.arguments[0]).toBe('-p');
    expect(seatbelt.arguments.slice(-2)).toEqual(['/usr/bin/npm', 'test']);
    expect(wrapForSandbox('docker', launch, linux, settings).executable).toBe('docker');
  });
});
