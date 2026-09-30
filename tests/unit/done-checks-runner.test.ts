import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { doneChecksPrompt, doneChecksProblem, runDoneChecks } from '../../src/sdk/done-checks';

import type { DoneCheck } from '../../src/sdk/done-checks.types';

let workspace = '';

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), 'claw-dc-runner-'));
});

afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

const node = (label: string, code: string, extra: Partial<DoneCheck> = {}): DoneCheck => ({
  label,
  executable: process.execPath,
  args: ['-e', code],
  ...extra,
});

describe('runDoneChecks', () => {
  it('passes when every check exits 0', async () => {
    const report = await runDoneChecks([node('a', ''), node('b', '')], workspace, undefined);

    expect(report.passed).toBe(true);
    expect(report.checks.map((check) => [check.label, check.ok, check.exitCode])).toEqual([
      ['a', true, 0],
      ['b', true, 0],
    ]);
  });

  it('runs all of them after a failure, so every failure is reported', async () => {
    const report = await runDoneChecks(
      [node('one', 'process.exit(3)'), node('two', ''), node('three', 'process.exit(4)')],
      workspace,
      undefined,
    );

    expect(report.passed).toBe(false);
    expect(report.checks.map((check) => [check.label, check.exitCode])).toEqual([
      ['one', 3],
      ['two', 0],
      ['three', 4],
    ]);
  });

  it('kills a check that outlives its timeout and reports it as not exited', async () => {
    const started = Date.now();
    const report = await runDoneChecks(
      [node('slow', 'setTimeout(() => {}, 60000)', { timeoutMs: 400 })],
      workspace,
      undefined,
    );

    expect(Date.now() - started).toBeLessThan(15_000);
    expect(report.checks[0]).toMatchObject({ ok: false, exitCode: -1 });
    expect(report.checks[0]?.output).toContain('Timed out after 400 ms');
  }, 20_000);

  it('runs in the workspace root by default and in a contained subdirectory on request', async () => {
    mkdirSync(path.join(workspace, 'sub'));
    const print = 'console.log("CWD=" + require("path").basename(process.cwd()))';

    const report = await runDoneChecks(
      [node('root', print), node('sub', print, { cwd: 'sub' })],
      workspace,
      undefined,
    );

    expect(report.checks[0]?.output).toContain(`CWD=${path.basename(workspace)}`);
    expect(report.checks[1]?.output).toContain('CWD=sub');
  });

  it.each([['..'], [path.join('sub', '..', '..')], [path.resolve(tmpdir())]])(
    'refuses a cwd outside the workspace (%s)',
    async (cwd) => {
      mkdirSync(path.join(workspace, 'sub'), { recursive: true });

      const report = await runDoneChecks([node('out', '', { cwd })], workspace, undefined);

      expect(report.checks[0]).toMatchObject({ ok: false, exitCode: -1 });
      expect(report.checks[0]?.output).toMatch(/escapes the workspace/u);
    },
  );

  it('keeps both ends of long output, within the limit', async () => {
    const code =
      'console.log("HEAD-MARK" + "x".repeat(20000)); console.error("y".repeat(20000) + "TAIL-MARK")';

    const report = await runDoneChecks([node('loud', code)], workspace, undefined);
    const output = report.checks[0]?.output ?? '';

    expect(output).toContain('HEAD-MARK');
    expect(output).toContain('TAIL-MARK');
    expect(output).toContain('chars omitted');
    expect(output.length).toBeLessThan(3_200);
  });

  it('redacts secrets in the output', async () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const code = `console.log("Authorization: Bearer ${secret}")`;

    const report = await runDoneChecks([node('leak', code)], workspace, undefined);

    expect(report.checks[0]?.output).not.toContain(secret);
    expect(report.checks[0]?.output).toContain('[REDACTED]');
  });

  it('does not hand the parent secrets to the check', async () => {
    process.env.CLAW_TOKEN = 'parent-secret-token-value';
    try {
      const report = await runDoneChecks(
        [
          node(
            'env',
            'console.log(process.env.CLAW_TOKEN === undefined ? "ENV-ABSENT" : "ENV-LEAKED")',
          ),
        ],
        workspace,
        undefined,
      );

      expect(report.checks[0]?.output).toContain('ENV-ABSENT');
    } finally {
      delete process.env.CLAW_TOKEN;
    }
  });

  it('closes stdin, so a check that waits for input ends instead of hanging', async () => {
    const code = 'process.stdin.resume(); process.stdin.on("end", () => process.exit(0))';

    const report = await runDoneChecks(
      [node('stdin', code, { timeoutMs: 8000 })],
      workspace,
      undefined,
    );

    expect(report.checks[0]).toMatchObject({ ok: true, exitCode: 0 });
  }, 15_000);

  it('reports a missing executable as a failed check, not an exception', async () => {
    const report = await runDoneChecks(
      [{ label: 'ghost', executable: 'definitely-not-a-program-xyz', args: [] }],
      workspace,
      undefined,
    );

    expect(report.checks[0]).toMatchObject({ ok: false, exitCode: -1 });
    expect(report.checks[0]?.output).toContain('not found');
  });

  it('reports a cancelled run as a failed check', async () => {
    const controller = new AbortController();
    controller.abort();

    const report = await runDoneChecks([node('late', '')], workspace, controller.signal);

    expect(report.passed).toBe(false);
    expect(report.checks[0]?.exitCode).toBe(-1);
  });
});

describe('doneChecksProblem', () => {
  const ok = node('a', '');

  it.each([
    ['an empty label', [{ ...ok, label: '  ' }]],
    ['a long label', [{ ...ok, label: 'x'.repeat(81) }]],
    ['no executable', [{ ...ok, executable: ' ' }]],
    ['a fractional timeout', [{ ...ok, timeoutMs: 1.5 }]],
    ['a timeout past an hour', [{ ...ok, timeoutMs: 3_600_001 }]],
    ['a repeated label', [ok, ok]],
    [
      'too many checks',
      Array.from({ length: 21 }, (_v, index) => ({ ...ok, label: `c${String(index)}` })),
    ],
  ])('names the problem with %s', (_name, checks) => {
    expect(doneChecksProblem(checks)).toEqual(expect.any(String));
  });

  it('accepts a timeout of exactly an hour', () => {
    expect(doneChecksProblem([{ ...ok, timeoutMs: 3_600_000 }])).toBeUndefined();
  });
});

describe('doneChecksPrompt', () => {
  it('lists only the failing checks with their exit code and output', () => {
    const prompt = doneChecksPrompt({
      passed: false,
      checks: [
        { label: 'good', ok: true, exitCode: 0, durationMs: 1, output: '' },
        { label: 'bad', ok: false, exitCode: 2, durationMs: 1, output: 'boom detail' },
      ],
    });

    expect(prompt).toContain("the orchestrator's completion checks failed");
    expect(prompt).toContain('Do NOT declare done until every check passes.');
    expect(prompt).toContain('bad: exit 2; boom detail');
    expect(prompt).not.toContain('good');
    expect(prompt.endsWith('Fix the real cause, then finish.')).toBe(true);
  });
});
