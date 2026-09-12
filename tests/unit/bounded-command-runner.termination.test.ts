import { mkdtemp, rm } from 'node:fs/promises';
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

async function workspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'claw-terminate-'));
  temporaryDirectories.push(directory);
  return directory;
}

function specification(script: string, timeoutMs: number): unknown {
  return {
    executable: process.execPath,
    arguments: ['-e', script],
    cwdRootKey: 'workspace-root',
    cwd: '.',
    environment: {},
    timeoutMs,
    outputLimitBytes: 4_096,
    expectedEffect: 'read' as const,
    targetId: 'target:workspace',
    elevation: false,
  };
}

describe('runCommandSpec termination', () => {
  it(
    'still finishes when the process refuses to stop on being asked',
    { timeout: 30_000 },
    async () => {
      // The regression: SIGTERM was sent once and the runner then waited for a
      // `close` event that a process trapping it never emits. On Windows there
      // is no graceful signal to trap, so this passes there for a different
      // reason than it passes on POSIX — both are the behaviour we want.
      const result = await runCommandSpec(
        specification("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);", 300),
        await workspace(),
      );

      expect(result.timedOut).toBe(true);
      expect(result.forciblyTerminated).toBe(true);
    },
  );

  it('does not report a forced kill for a command that exits on its own', async () => {
    const result = await runCommandSpec(
      specification("process.stdout.write('done');", 10_000),
      await workspace(),
    );

    expect(result.exitCode).toBe(0);
    expect(result.forciblyTerminated).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  // Same escalation as the first case, so the same allowance. On POSIX this
  // waits out the full grace period before SIGKILL lands, which is longer than
  // vitest's default and is the whole behaviour under test.
  it(
    'keeps the output the process produced before it was killed',
    { timeout: 30_000 },
    async () => {
      const result = await runCommandSpec(
        specification(
          "process.stdout.write('before'); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
          300,
        ),
        await workspace(),
      );

      expect(result.stdout).toContain('before');
    },
  );
});
