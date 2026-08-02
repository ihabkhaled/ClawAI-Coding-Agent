import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import {
  buildRuntimeCapabilityManifest,
  detectRuntimePrerequisites,
  describeExtensionHost,
  describeRuntimeTarget,
} from '../../src/infrastructure/vscode-runtime-target-adapter';

import type { RuntimeHostProbe } from '../../src/infrastructure/vscode-runtime-target.types';

const localProbe: RuntimeHostProbe = {
  architecture: 'x64',
  extensionKind: 'workspace',
  extensionVersion: '0.40.0',
  platform: 'win32',
  remoteName: undefined,
  shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  uiKind: 'desktop',
  vscodeVersion: '1.110.0',
  workspaceFolders: [{ name: 'ClawAI', scheme: 'file', uri: 'file:///D:/Freelance/Claw' }],
  workspaceTrusted: true,
  prerequisites: {
    browser: true,
    container: true,
    database: true,
    elevation: true,
    git: true,
    process: true,
  },
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('VS Code runtime target adapter', () => {
  it('does not advertise browser control when only the bundled library exists', async () => {
    const extensionRoot = await mkdtemp(path.join(tmpdir(), 'clawai-browser-probe-'));
    temporaryDirectories.push(extensionRoot);
    await mkdir(path.join(extensionRoot, 'node_modules', 'playwright-core'), { recursive: true });

    expect(detectRuntimePrerequisites(extensionRoot).browser).toBe(false);
  });

  it.each([
    [{}, 'desktop-local', 'local'],
    [{ platform: 'darwin' }, 'desktop-local', 'local'],
    [{ platform: 'linux' }, 'desktop-local', 'local'],
    [{ remoteName: 'wsl', platform: 'linux' }, 'remote-wsl', 'wsl'],
    [{ remoteName: 'ssh-remote', platform: 'linux' }, 'remote-ssh', 'remote-ssh'],
    [{ remoteName: 'dev-container', platform: 'linux' }, 'dev-container', 'dev-container'],
    [{ remoteName: 'codespaces', platform: 'linux', uiKind: 'web' }, 'codespaces', 'codespace'],
    [{ remoteName: undefined, uiKind: 'web' }, 'web-limited', 'unknown'],
    [{ remoteName: 'future-remote' }, 'unknown', 'unknown'],
  ] as const)('maps host facts %o truthfully', (patch, hostKind, targetKind) => {
    const probe = { ...localProbe, ...patch };

    expect(describeExtensionHost(probe).hostKind).toBe(hostKind);
    expect(describeRuntimeTarget(probe).kind).toBe(targetKind);
  });

  it.each([
    ['win32', 'windows'],
    ['darwin', 'macos'],
    ['linux', 'linux'],
    ['aix', 'unknown'],
  ] as const)('maps %s to the %s OS family', (platform, osFamily) => {
    expect(describeRuntimeTarget({ ...localProbe, platform }).osFamily).toBe(osFamily);
  });

  it('maps known architectures and shells without disclosing the shell path', () => {
    const target = describeRuntimeTarget(localProbe);

    expect(target.architecture).toBe('x64');
    expect(target.shells).toEqual(['powershell']);
    expect(target.defaultShell).toBe('powershell');
    expect(JSON.stringify(target)).not.toContain('System32');
    expect(
      describeRuntimeTarget({ ...localProbe, architecture: 'riscv64', shell: 'mystery' }),
    ).toMatchObject({
      architecture: 'unknown',
      shells: [],
      defaultShell: undefined,
    });
  });

  it('limits untrusted and virtual workspaces to read-only capabilities', () => {
    const untrusted = describeRuntimeTarget({ ...localProbe, workspaceTrusted: false });
    const virtual = describeRuntimeTarget({
      ...localProbe,
      workspaceFolders: [
        { name: 'Virtual', scheme: 'vscode-vfs', uri: 'vscode-vfs://example/project' },
      ],
    });

    expect(untrusted.workspaceRoots[0]?.access).toBe('read');
    expect(untrusted.capabilities).not.toContain('legacy.edit-plan');
    expect(virtual.workspaceRoots[0]?.access).toBe('read');
    expect(virtual.capabilities).not.toContain('legacy.edit-plan');
  });

  it('supports empty and multi-root workspaces without embedding root URIs in identifiers', () => {
    expect(describeRuntimeTarget({ ...localProbe, workspaceFolders: [] }).workspaceRoots).toEqual(
      [],
    );
    const target = describeRuntimeTarget({
      ...localProbe,
      workspaceFolders: [
        { name: 'First', scheme: 'file', uri: 'file:///private/first' },
        { name: 'Second', scheme: 'file', uri: 'file:///private/second' },
      ],
    });

    expect(target.workspaceRoots.map((root) => root.rootKey)).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
    expect(target.id).toBe('target:workspace');
    expect(target.id).not.toContain('private');
  });

  it('builds a strict manifest containing only capabilities the target can support', () => {
    const manifest = buildRuntimeCapabilityManifest(localProbe, {
      generatedAt: '2026-08-02T03:00:00.000Z',
      manifestId: 'manifest:runtime-v2',
    });

    expect(manifest.extension.hostKind).toBe('desktop-local');
    expect(manifest.targets.map((target) => target.id)).toEqual([
      'target:workspace',
      'target:container',
      'target:database',
      'target:browser',
    ]);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'legacy.chat',
        'legacy.edit-plan',
        'workspace.files',
        'workspace.command',
        'workspace.process',
        'workspace.git',
        'workspace.quality',
        'workspace.intelligence',
        'workspace.planning',
        'runtime.journal',
        'runtime.evidence',
        'workspace.services',
        'workspace.container',
        'workspace.database',
        'workspace.browser',
      ]),
    );
    expect(JSON.stringify(manifest)).not.toContain('System32');
  });

  it('omits specialized and orchestrator capabilities when prerequisites are unavailable', () => {
    const manifest = buildRuntimeCapabilityManifest(
      {
        ...localProbe,
        prerequisites: {
          browser: false,
          container: false,
          database: false,
          elevation: false,
          git: false,
          process: false,
        },
      },
      { generatedAt: '2026-08-02T03:00:00.000Z', manifestId: 'manifest:degraded' },
    );

    expect(manifest.targets.map(({ id }) => id)).toEqual(['target:workspace']);
    expect(manifest.tools.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        'workspace.git',
        'workspace.process',
        'workspace.container',
        'workspace.database',
        'workspace.browser',
        'runtime.agents',
        'runtime.integration',
        'runtime.flagship',
        'runtime.elevation',
      ]),
    );
  });
});
