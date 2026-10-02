import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { textLine } from '../../src/headless/headless-output';
import { parsePlanFile } from '../../src/headless/headless-plan-file';
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

describe('--plan-file and --require-plan flags', () => {
  it('reads --plan-file against the working directory and --require-plan as a bare flag', () => {
    const parsed = parse('--plan-file', 'plan.json', '--require-plan');
    expect(parsed).toMatchObject({
      kind: 'run',
      invocation: { planFile: path.resolve(cwd, 'plan.json'), requirePlan: true },
    });
  });

  it('leaves both absent when not given', () => {
    const parsed = parse();
    expect(parsed.kind === 'run' && parsed.invocation.planFile).toBeFalsy();
    expect(parsed.kind === 'run' && parsed.invocation.requirePlan).toBeFalsy();
  });

  it('needs a value for --plan-file', () => {
    expect(parse('--plan-file').kind).toBe('usage');
  });
});

describe('parsePlanFile', () => {
  it('accepts an array or an object with steps, and keeps checks', () => {
    const steps = [
      { id: 'a', title: 'A', check: { executable: 'node', args: ['-e', '0'] } },
      { title: 'B' },
    ];
    const fromArray = parsePlanFile(JSON.stringify(steps));
    const fromObject = parsePlanFile(JSON.stringify({ steps }));
    expect(fromArray).toEqual(fromObject);
    expect(fromArray).toMatchObject([
      { id: 'a', check: { executable: 'node' } },
      { id: 's2', title: 'B' },
    ]);
  });

  it.each([
    ['not json', '{oops', /not valid JSON/u],
    ['no steps', '{}', /non-empty array/u],
    ['an empty array', '[]', /non-empty array/u],
    ['a step without a title', '[{"id":"a"}]', /title/u],
    ['a duplicate id', '[{"id":"a","title":"x"},{"id":"a","title":"y"}]', /Two steps/u],
    ['a check without an executable', '[{"title":"x","check":{"args":[]}}]', /executable/u],
  ])('names the problem for %s', (_name, text, pattern) => {
    const parsed = parsePlanFile(text);
    expect(typeof parsed).toBe('string');
    expect(parsed).toMatch(pattern);
    expect(parsed).toMatch(/^--plan-file/u);
  });
});

describe('the CLI with a plan', () => {
  async function cli(args: string[], scripts: Parameters<typeof scriptedRuns>[0]) {
    const runtime = scriptedRuns(scripts);
    const out: string[] = [];
    const err: string[] = [];
    const code = await runHeadlessCli(
      args,
      { CLAW_TOKEN: 'cli-token-123' },
      { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) },
      { cwd: state, transport: runtime.transport },
    );
    return { code, out: out.join(''), err: err.join(''), runtime };
  }

  it('exits 2 before any request when the plan file is unusable', async () => {
    const file = path.join(state, 'bad.json');
    writeFileSync(file, '[{"title":""}]');
    const { code, err, runtime } = await cli(
      ['-p', 'x', '--plan-file', file, '--workspace', state],
      [[COMPLETED]],
    );
    expect(code).toBe(2);
    expect(err).toMatch(/--plan-file/u);
    expect(runtime.starts).toHaveLength(0);
  });

  it('exits 1 with PLAN_INCOMPLETE when a preloaded step is never done', async () => {
    const file = path.join(state, 'plan.json');
    writeFileSync(file, '[{"id":"a","title":"Do A"}]');
    const { code, err, runtime, out } = await cli(
      [
        '-p',
        'x',
        '--plan-file',
        file,
        '--workspace',
        state,
        '--output-format',
        'stream-json',
        '--auto-continue',
        '1',
      ],
      [[COMPLETED], [COMPLETED]],
    );
    expect(code).toBe(1);
    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[0]?.prompt).toContain('a [todo] Do A');
    expect(out).toContain('"type":"run.plan"');
    expect(out).toContain('"reason":"plan-incomplete"');
    expect(out).toContain('PLAN_INCOMPLETE');
    expect(err).toBe('');
  });

  it('exits 1 under --require-plan when no plan was made', async () => {
    const { code, runtime } = await cli(
      ['-p', 'x', '--require-plan', '--workspace', state, '--auto-continue', '0'],
      [[COMPLETED]],
    );
    expect(code).toBe(1);
    expect(runtime.starts).toHaveLength(1);
  });
});

describe('how a person watching a text run sees the plan', () => {
  it('prints a one-line progress and the new continuation reason', () => {
    expect(textLine({ type: 'run.plan', total: 4, todo: 1, doing: 1, done: 2, blocked: 0 })).toBe(
      '[plan] 2/4 done, 1 in progress, 0 blocked\n',
    );
    expect(textLine({ type: 'run.continued', attempt: 1, reason: 'plan-incomplete' })).toMatch(
      /task plan still has open steps/u,
    );
  });
});
