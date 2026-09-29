import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const present = vi.hoisted(() => vi.fn((executable: string) => executable === 'docker'));

vi.mock('../../src/infrastructure/vscode-sandbox-probe', () => ({ present }));

import {
  existingCredentials,
  probeCommandSandboxHost,
  realPath,
} from '../../src/infrastructure/command-sandbox-host-probe';

describe('probeCommandSandboxHost', () => {
  it('probes only the helpers this platform can use, and docker everywhere', () => {
    const host = probeCommandSandboxHost();
    expect(host.platform).toBe(process.platform);
    expect(host.docker).toBe(true);
    if (process.platform !== 'linux') {
      expect(host.bubblewrap).toBe(false);
      expect(host.existingCredentialPaths).toEqual([]);
    }
    if (process.platform !== 'darwin') expect(host.sandboxExec).toBe(false);
    expect(host.temporaryDirectories).toHaveLength(1);
    expect(host.homeDirectory.length).toBeGreaterThan(0);
  });

  it('keeps a path it cannot resolve rather than throwing', () => {
    expect(realPath('/definitely/not/here/clawai')).toBe('/definitely/not/here/clawai');
  });
});

describe('existingCredentials', () => {
  it('lists only credential stores that exist, by kind', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'clawai-sandbox-home-'));
    try {
      await mkdir(path.join(home, '.ssh'));
      await writeFile(path.join(home, '.npmrc'), 'token');
      const found = existingCredentials(home);
      expect(found).toEqual([
        { path: path.posix.join(home, '.ssh'), kind: 'directory' },
        { path: path.posix.join(home, '.npmrc'), kind: 'file' },
      ]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
