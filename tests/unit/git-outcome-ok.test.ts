import { describe, expect, it } from 'vitest';

import { outcome, stripTerminalCodes } from '../../src/sdk/git-tools-run';

import type { GitRunResult } from '../../src/sdk/git-tools.types';

function run(overrides: Partial<GitRunResult>): GitRunResult {
  return { exitCode: 0, stdout: '', stderr: '', timedOut: false, aborted: false, ...overrides };
}

describe('git tool outcome', () => {
  it('says ok only when git exited cleanly, because the envelope calls every returned call succeeded', () => {
    expect(outcome(run({}))).toMatchObject({ ok: true, exitCode: 0 });
    expect(outcome(run({ exitCode: 1 }))).toMatchObject({ ok: false, exitCode: 1 });
    expect(outcome(run({ timedOut: true, exitCode: 0 }))).toMatchObject({ ok: false });
    expect(outcome(run({ aborted: true, exitCode: 0 }))).toMatchObject({ ok: false });
  });

  it('keeps the extra fields a caller adds', () => {
    expect(outcome(run({ exitCode: 1 }), { committed: false })).toMatchObject({
      ok: false,
      committed: false,
    });
  });

  it('removes colour and cursor codes from stdout and stderr', () => {
    const esc = String.fromCharCode(27);
    const result = outcome(
      run({ stdout: `${esc}[32mPASS${esc}[0m ok`, stderr: `${esc}[1;31mFAIL${esc}[0m\n${esc}[2K` }),
    );

    expect(result.stdout).toBe('PASS ok');
    expect(result.stderr).toBe('FAIL\n');
  });
});

describe('stripTerminalCodes', () => {
  it('leaves ordinary brackets and text alone', () => {
    expect(stripTerminalCodes('[ok] a[0] = 1')).toBe('[ok] a[0] = 1');
  });
});
