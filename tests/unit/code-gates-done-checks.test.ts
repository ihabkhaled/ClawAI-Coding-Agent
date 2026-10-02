import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { resolveHeadlessInputs } from '../../src/headless/headless-inputs';
import { gateDoneChecks, parseGateNames } from '../../src/sdk/code-gates-done-checks';
import { runDoneChecks } from '../../src/sdk/done-checks';

import { cleanUpFixtures, emptyFolder, fixtureProject, writeFiles } from './code-gates.helpers';

import type { DoneCheck } from '../../src/sdk/done-checks.types';

cleanUpFixtures();

function checksOf(value: readonly DoneCheck[] | string): readonly DoneCheck[] {
  if (typeof value === 'string') throw new Error(value);
  return value;
}

describe('parseGateNames', () => {
  it('splits a comma list and repeats, once each', () => {
    expect(parseGateNames(['lint,typecheck', 'test,lint'])).toEqual(['lint', 'typecheck', 'test']);
  });

  it('names the word that is not a gate', () => {
    expect(parseGateNames(['lint,deploy'])).toContain('"deploy" is not a gate');
  });

  it('wants at least one gate', () => {
    expect(parseGateNames([' , '])).toContain('at least one gate');
  });
});

describe('gateDoneChecks', () => {
  it('expands to the real commands of the project', () => {
    const root = fixtureProject();
    expect(gateDoneChecks(['lint', 'typecheck', 'test'], root)).toEqual([
      expect.objectContaining({ label: 'gate:lint', executable: 'npm', args: ['run', 'lint'] }),
      expect.objectContaining({
        label: 'gate:typecheck',
        executable: 'npm',
        args: ['run', 'typecheck'],
      }),
      expect.objectContaining({ label: 'gate:test', executable: 'npm', args: ['run', 'test'] }),
    ]);
  });

  it('is an error, not a silent pass, for a gate the project cannot run', () => {
    const root = emptyFolder();
    writeFiles(root, {
      'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node a.js' } }),
    });
    expect(gateDoneChecks(['lint'], root)).toContain('no lint command was found');
  });

  it('is an error when the workspace root is not a project', () => {
    expect(gateDoneChecks(['test'], emptyFolder())).toContain('not a project');
  });

  it('uses the only workspace folder of a monorepo, with its folder as cwd', () => {
    const root = emptyFolder();
    writeFiles(root, {
      'package.json': JSON.stringify({ name: 'm', workspaces: ['apps/*'] }),
      'apps/one/package.json': JSON.stringify({ name: 'one', scripts: { test: 'node a.js' } }),
    });
    expect(gateDoneChecks(['test'], root)).toEqual([
      expect.objectContaining({ label: 'gate:test', cwd: 'apps/one' }),
    ]);
  });

  it('passes for a healthy project and fails for a broken one when run as done checks', async () => {
    const good = fixtureProject();
    const green = await runDoneChecks(
      checksOf(gateDoneChecks(['typecheck', 'test'], good)),
      good,
      undefined,
    );
    expect(green.passed).toBe(true);
    const bad = fixtureProject({ 'src/bad.ts': "export const n: number = 'x';\n" });
    const red = await runDoneChecks(checksOf(gateDoneChecks(['typecheck'], bad)), bad, undefined);
    expect(red.passed).toBe(false);
    expect(red.checks[0]?.output).toContain('TS2322');
  }, 120_000);
});

describe('--done-check-gates flag', () => {
  const cwd = path.resolve('/work');

  it('parses into gate names', () => {
    const parsed = parseHeadlessArgs(['-p', 't', '--done-check-gates', 'lint,test'], {}, cwd);
    expect(parsed).toMatchObject({ kind: 'run', invocation: { doneCheckGates: ['lint', 'test'] } });
  });

  it('refuses an unknown gate at parse time', () => {
    const parsed = parseHeadlessArgs(['-p', 't', '--done-check-gates', 'lint,wat'], {}, cwd);
    expect(parsed).toMatchObject({ kind: 'usage' });
    expect(JSON.stringify(parsed)).toContain('is not a gate');
  });

  it('expands into done checks when the inputs are resolved', async () => {
    const root = fixtureProject();
    const parsed = parseHeadlessArgs(
      ['-p', 't', '--workspace', root, '--done-check-gates', 'lint,test'],
      {},
      root,
    );
    if (parsed.kind !== 'run') throw new Error('did not parse');
    const inputs = await resolveHeadlessInputs(parsed.invocation, root);
    expect(inputs).toMatchObject({ ok: true });
    if (!inputs.ok) throw new Error('inputs failed');
    expect(inputs.doneChecks?.map((check) => check.label)).toEqual(['gate:lint', 'gate:test']);
  });

  it('reports a gate the project cannot run before any request is made', async () => {
    const root = emptyFolder();
    writeFiles(root, { 'package.json': '{"name":"x"}' });
    const parsed = parseHeadlessArgs(
      ['-p', 't', '--workspace', root, '--done-check-gates', 'build'],
      {},
      root,
    );
    if (parsed.kind !== 'run') throw new Error('did not parse');
    const inputs = await resolveHeadlessInputs(parsed.invocation, root);
    expect(inputs).toMatchObject({ ok: false });
    expect(JSON.stringify(inputs)).toContain('no build command was found');
  });
});
