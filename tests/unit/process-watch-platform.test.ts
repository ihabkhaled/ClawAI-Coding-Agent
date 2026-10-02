import { describe, expect, it } from 'vitest';

import { killTreeNow } from '../../src/sdk/process-watch-kill';
import { createProcessWatchTool } from '../../src/sdk/process-watch-tool';

import type { CommandRuntime } from '../../src/sdk/command-tool.types';

const WINDOWS: CommandRuntime = {
  platform: 'win32',
  environment: { Path: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
  exists: (file) => file === 'C:\\tools\\npm.CMD',
};

const POSIX: CommandRuntime = {
  platform: 'linux',
  environment: { PATH: '/usr/bin' },
  exists: () => false,
};

const limits = { workspace: process.cwd(), allowedExecutables: ['npm', 'node'] };

describe('process.watch platform handling', () => {
  it('refuses Windows shim arguments that cmd.exe would read as syntax, before any spawn', async () => {
    const tool = createProcessWatchTool({ runtime: WINDOWS });

    for (const argument of ['a&b', '%PATH%', 'x"y', 'a|b', 'dir\\']) {
      await expect(
        Promise.resolve().then(() =>
          tool.execute(
            'start',
            { name: 'n', executable: 'npm', arguments: ['run', argument] },
            limits,
          ),
        ),
      ).rejects.toThrow(/Windows script shim/u);
    }
    tool.dispose();
  });

  it('says plainly when the program is not on PATH, on either platform', async () => {
    for (const runtime of [WINDOWS, POSIX]) {
      const tool = createProcessWatchTool({ runtime });
      await expect(
        Promise.resolve().then(() =>
          tool.execute('start', { name: 'n', executable: 'node', arguments: [] }, limits),
        ),
      ).rejects.toThrow(/was not found on PATH/u);
      tool.dispose();
    }
  });

  it('kills by taskkill on Windows and by process group on POSIX', () => {
    const calls: string[] = [];
    const child = {
      pid: 4242,
      kill: () => {
        calls.push('child.kill');
        return true;
      },
    };

    killTreeNow(child as never, 'linux');

    expect(calls).toContain('child.kill');
  });
});
