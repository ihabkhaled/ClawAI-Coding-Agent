import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runCommandSpec } from '../../src/infrastructure/bounded-command-runner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

function commandSpec(overrides: Record<string, unknown> = {}): unknown {
  return {
    executable: process.execPath,
    arguments: [],
    cwdRootKey: 'workspace-root',
    cwd: '.',
    environment: {},
    timeoutMs: 10_000,
    outputLimitBytes: 4_096,
    expectedEffect: 'read' as const,
    targetId: 'target:workspace',
    elevation: false,
    ...overrides,
  };
}

describe('runCommandSpec', () => {
  it('spawns a plain executable and captures its output', async () => {
    const result = await runCommandSpec(
      commandSpec({ arguments: ['-e', "process.stdout.write('ok')"] }),
      process.cwd(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  // Windows cannot execute a .bat/.cmd file directly via CreateProcess — Node's
  // spawn() throws `spawn EINVAL` unless the call goes through cmd.exe. `npm`,
  // `npx`, and `gradlew.bat` all resolve to batch files on Windows, so this
  // reproduces the exact failure ClawAI hit running `npm run package`.
  it.skipIf(process.platform !== 'win32')(
    'spawns a resolved .cmd file without spawn EINVAL',
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'clawai-cmd-spawn-'));
      temporaryDirectories.push(directory);
      const scriptPath = path.join(directory, 'greet.cmd');
      await writeFile(scriptPath, '@echo off\r\necho hello-from-cmd\r\n');

      const result = await runCommandSpec(commandSpec({ executable: scriptPath }), process.cwd());

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('hello-from-cmd');
    },
  );
});
