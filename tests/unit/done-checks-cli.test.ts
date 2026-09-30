import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import {
  parseDoneCheckFile,
  parseDoneCheckFlag,
  splitCommandLine,
} from '../../src/headless/headless-done-checks';
import { textLine } from '../../src/headless/headless-output';
import { COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

const cwd = path.resolve('/work');
const created: string[] = [];
let state = '';
const saved = process.env.CLAW_STATE_DIR;

beforeEach(() => {
  state = mkdtempSync(path.join(tmpdir(), 'claw-state-'));
  created.push(state);
  process.env.CLAW_STATE_DIR = state;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function parse(...extra: string[]) {
  return parseHeadlessArgs(['-p', 'task', ...extra], {}, cwd);
}

describe('splitCommandLine', () => {
  it.each([
    ['npm test', ['npm', 'test']],
    ['  git   diff  --quiet ', ['git', 'diff', '--quiet']],
    ['node -e "console.log(1 + 1)"', ['node', '-e', 'console.log(1 + 1)']],
    ['node -e \'console.log("hi there")\'', ['node', '-e', 'console.log("hi there")']],
    ['a --x="b c" d', ['a', '--x=b c', 'd']],
    ['a "" b', ['a', '', 'b']],
    ['C:\\tools\\run.exe --flag', ['C:\\tools\\run.exe', '--flag']],
  ])('splits %s', (text, words) => {
    expect(splitCommandLine(text)).toEqual(words);
  });

  it('names an unterminated quote', () => {
    expect(splitCommandLine('node -e "oops')).toMatch(/unterminated/u);
  });
});

describe('--done-check', () => {
  it('reads repeatable label=command flags in order', () => {
    const parsed = parse(
      '--done-check',
      'tests=npm test',
      '--done-check',
      'pushed=git diff --quiet origin/main HEAD',
    );

    expect(parsed.kind).toBe('run');
    if (parsed.kind !== 'run') return;
    expect(parsed.invocation.doneChecks).toEqual([
      { label: 'tests', executable: 'npm', args: ['test'] },
      { label: 'pushed', executable: 'git', args: ['diff', '--quiet', 'origin/main', 'HEAD'] },
    ]);
  });

  it('keeps an = inside the command after the first one', () => {
    expect(parseDoneCheckFlag('eq=node -e "a=b"')).toEqual({
      label: 'eq',
      executable: 'node',
      args: ['-e', 'a=b'],
    });
  });

  it('leaves doneChecks unset when the flag is absent', () => {
    const parsed = parse();

    expect(parsed.kind === 'run' && parsed.invocation.doneChecks).toBeUndefined();
  });

  it.each([
    ['no label', 'npm test'],
    ['an empty label', '=npm test'],
    ['no executable', 'tests='],
    ['an unterminated quote', 'tests=node -e "x'],
    ['a blank label', '   =npm test'],
  ])('is a usage error for %s', (_name, value) => {
    const parsed = parse('--done-check', value);

    expect(parsed.kind).toBe('usage');
  });

  it('is a usage error for a repeated label', () => {
    const parsed = parse('--done-check', 'a=npm test', '--done-check', 'a=npm run lint');

    expect(parsed).toMatchObject({ kind: 'usage', message: expect.stringContaining('both') });
  });

  it('is a usage error when the value is missing', () => {
    expect(parse('--done-check').kind).toBe('usage');
  });
});

describe('--done-check-file', () => {
  it('accepts an array with optional cwd and timeoutMs', () => {
    const text = JSON.stringify([
      { label: 'unit', executable: 'npm', args: ['test'], cwd: 'app', timeoutMs: 5000 },
      { label: 'files', executable: 'node', args: [] },
    ]);

    expect(parseDoneCheckFile(text)).toEqual([
      { label: 'unit', executable: 'npm', args: ['test'], cwd: 'app', timeoutMs: 5000 },
      { label: 'files', executable: 'node', args: [], cwd: undefined, timeoutMs: undefined },
    ]);
  });

  it.each([
    ['not JSON', '{oops'],
    ['an object', '{"label":"a"}'],
    ['a non-object entry', '[1]'],
    ['a missing executable', '[{"label":"a","args":[]}]'],
    ['non-string args', '[{"label":"a","executable":"x","args":[1]}]'],
    ['a missing args array', '[{"label":"a","executable":"x"}]'],
    ['a non-string cwd', '[{"label":"a","executable":"x","args":[],"cwd":1}]'],
    ['a string timeout', '[{"label":"a","executable":"x","args":[],"timeoutMs":"9"}]'],
    [
      'a timeout over the ceiling',
      '[{"label":"a","executable":"x","args":[],"timeoutMs":3600001}]',
    ],
    ['a zero timeout', '[{"label":"a","executable":"x","args":[],"timeoutMs":0}]'],
    ['an empty label', '[{"label":" ","executable":"x","args":[]}]'],
    [
      'a duplicate label',
      '[{"label":"a","executable":"x","args":[]},{"label":"a","executable":"y","args":[]}]',
    ],
  ])('rejects %s', (_name, text) => {
    expect(typeof parseDoneCheckFile(text)).toBe('string');
  });

  it('resolves the path against the working directory', () => {
    const parsed = parse('--done-check-file', 'ci/checks.json');

    expect(parsed.kind === 'run' && parsed.invocation.doneCheckFile).toBe(
      path.resolve(cwd, 'ci/checks.json'),
    );
  });
});

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (t: string) => out.push(t), stderr: (t: string) => err.push(t) },
  };
}

const ENVIRONMENT = { CLAW_TOKEN: 'cli-token-123' };

describe('the CLI with completion checks', () => {
  it('exits 2 before any request when the check file is unusable', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'claw-dc-'));
    created.push(workspace);
    writeFileSync(path.join(workspace, 'checks.json'), '{"not":"an array"}');
    const runtime = scriptedRuns([[COMPLETED]]);
    const { io, err } = harness();

    const code = await runHeadlessCli(
      ['-p', 'go', '--workspace', workspace, '--done-check-file', 'checks.json'],
      ENVIRONMENT,
      io,
      { cwd: workspace, transport: runtime.transport },
    );

    expect(code).toBe(2);
    expect(runtime.starts).toHaveLength(0);
    expect(err.join('')).toContain('JSON array');
  });

  it('merges the file and the flags, and prints checks in the json result', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'claw-dc-'));
    created.push(workspace);
    const pass = { label: 'file-check', executable: process.execPath, args: ['-e', ''] };
    writeFileSync(path.join(workspace, 'checks.json'), JSON.stringify([pass]));
    const runtime = scriptedRuns([[COMPLETED]]);
    const { io, out } = harness();

    const code = await runHeadlessCli(
      [
        '-p',
        'go',
        '--workspace',
        workspace,
        '--output-format',
        'json',
        '--done-check-file',
        'checks.json',
        '--done-check',
        `flag-check="${process.execPath}" -e ""`,
      ],
      ENVIRONMENT,
      io,
      { cwd: workspace, transport: runtime.transport },
    );

    const result = JSON.parse(out.join('')) as { checks: unknown; outcome: string };
    expect(code).toBe(0);
    expect(result.outcome).toBe('completed');
    expect(result.checks).toEqual([
      { label: 'file-check', ok: true, exitCode: 0 },
      { label: 'flag-check', ok: true, exitCode: 0 },
    ]);
  });

  it('exits 1 with DONE_CHECKS_FAILED when a check fails and continuations are off', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'claw-dc-'));
    created.push(workspace);
    const runtime = scriptedRuns([[COMPLETED]]);
    const { io, out } = harness();

    const code = await runHeadlessCli(
      [
        '-p',
        'go',
        '--workspace',
        workspace,
        '--auto-continue',
        '0',
        '--output-format',
        'stream-json',
        '--done-check',
        `gate="${process.execPath}" -e "process.exit(7)"`,
      ],
      ENVIRONMENT,
      io,
      { cwd: workspace, transport: runtime.transport },
    );

    const lines = out.join('').trim().split('\n');
    const last = JSON.parse(lines.at(-1) ?? '{}') as { result: Record<string, unknown> };
    expect(code).toBe(1);
    expect(lines.some((line) => line.includes('"type":"run.checks"'))).toBe(true);
    expect(last.result).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      errorCode: 'DONE_CHECKS_FAILED',
      checks: [{ label: 'gate', ok: false, exitCode: 7 }],
    });
  });
});

describe('textLine for completion checks', () => {
  it('says which checks failed, and that all passed', () => {
    const base = { durationMs: 1, exitCode: 0 };

    expect(
      textLine({
        type: 'run.checks',
        passed: false,
        checks: [
          { label: 'a', ok: true, ...base },
          { label: 'b', ok: false, ...base },
        ],
      }),
    ).toBe('[checks] failed: b\n');
    expect(
      textLine({ type: 'run.checks', passed: true, checks: [{ label: 'a', ok: true, ...base }] }),
    ).toBe('[checks] all 1 passed\n');
    expect(textLine({ type: 'run.continued', attempt: 1, reason: 'checks-failed' })).toContain(
      'completion checks failed',
    );
  });
});
