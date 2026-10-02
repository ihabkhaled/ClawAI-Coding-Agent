import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  callGates,
  cleanUpFixtures,
  fixtureProject,
  summaryOf,
  writeFiles,
} from './code-gates.helpers';

cleanUpFixtures();

const SLOW = 180_000;

describe('code.gates run on real fixture projects', () => {
  it(
    'passes every gate on a healthy project, with a short result',
    async () => {
      const root = fixtureProject();
      for (const gate of ['lint', 'typecheck', 'test', 'format'] as const) {
        const result = await callGates(root, 'run', { gate });
        expect(result, gate).toMatchObject({ gate, status: 'pass', ok: true, exitCode: 0 });
        expect(summaryOf(result).errors).toBe(0);
        expect(result.tail).toBe('');
        expect(JSON.stringify(result).length).toBeLessThan(600);
      }
      const build = await callGates(root, 'run', { gate: 'build' });
      expect(build).toMatchObject({ status: 'pass', ok: true });
      expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
    },
    SLOW,
  );

  it(
    'reports a type error with file, position and code',
    async () => {
      const root = fixtureProject({ 'src/bad.ts': "export const n: number = 'x';\n" });
      const result = await callGates(root, 'run', { gate: 'typecheck' });
      expect(result).toMatchObject({ status: 'fail', ok: false });
      expect(result.exitCode).not.toBe(0);
      const summary = summaryOf(result);
      expect(summary.errors).toBe(1);
      expect(summary.issues[0]).toMatch(/^src[\\/]bad\.ts:1:14 TS2322 /u);
    },
    SLOW,
  );

  it(
    'reports lint errors with the rule that fired',
    async () => {
      const root = fixtureProject({ 'src/old.ts': 'var x = 1;\nexport const y = x == 1;\n' });
      const result = await callGates(root, 'run', { gate: 'lint' });
      expect(result).toMatchObject({ status: 'fail', ok: false });
      const summary = summaryOf(result);
      expect(summary.errors).toBe(2);
      expect(summary.issues.join('\n')).toContain('(no-var)');
      expect(summary.issues.join('\n')).toContain('(eqeqeq)');
    },
    SLOW,
  );

  it(
    'reports a failing test with its file, name and message',
    async () => {
      const root = fixtureProject({
        'src/math.test.ts':
          "import { expect, test } from 'vitest';\nimport { add } from './math';\n\ntest('adds', () => {\n  expect(add(1, 2)).toBe(4);\n});\n",
      });
      const result = await callGates(root, 'run', { gate: 'test' });
      expect(result).toMatchObject({ status: 'fail', ok: false });
      expect(result.flaky).toBeUndefined();
      const [failed] = summaryOf(result).failedTests;
      expect(failed?.name).toBe('adds');
      expect(failed?.file).toMatch(/math\.test\.ts$/u);
      expect(failed?.message).toContain('expected 3 to be 4');
      expect((failed?.message ?? '').length).toBeLessThanOrEqual(200);
    },
    SLOW,
  );

  it(
    'lists the files prettier would change',
    async () => {
      const root = fixtureProject({ 'src/ugly.ts': 'export const   z =    1\n' });
      const result = await callGates(root, 'run', { gate: 'format' });
      expect(result).toMatchObject({ status: 'fail', ok: false });
      expect(summaryOf(result).issues).toEqual(['src/ugly.ts is not formatted']);
    },
    SLOW,
  );

  it(
    'narrows lint to the files given',
    async () => {
      const root = fixtureProject({
        'src/old.ts': 'var x = 1;\nexport { x };\n',
        'src/other.ts': 'var y = 1;\nexport { y };\n',
      });
      const result = await callGates(root, 'run', { gate: 'lint', files: ['src/old.ts'] });
      expect(summaryOf(result).errors).toBe(1);
      expect(summaryOf(result).issues[0]).toContain('old.ts');
    },
    SLOW,
  );

  it(
    'calls a test that fails once and then passes flaky, not fixed',
    async () => {
      const root = fixtureProject({
        'src/flaky.test.ts':
          "import { existsSync, writeFileSync } from 'node:fs';\nimport { expect, test } from 'vitest';\n\ntest('flips', () => {\n  const seen = existsSync('.seen');\n  writeFileSync('.seen', '1');\n  expect(seen).toBe(true);\n});\n",
      });
      const result = await callGates(root, 'run', { gate: 'test' });
      expect(result).toMatchObject({ status: 'pass', ok: true, flaky: true });
      expect(String(result.note)).toContain('flaky?');
      expect(summaryOf(result).failedTests[0]?.name).toBe('flips');
    },
    SLOW,
  );

  it(
    'turns green after the fix, run again with the same call',
    async () => {
      const root = fixtureProject({ 'src/bad.ts': "export const n: number = 'x';\n" });
      expect((await callGates(root, 'run', { gate: 'typecheck' })).ok).toBe(false);
      writeFiles(root, { 'src/bad.ts': 'export const n: number = 1;\n' });
      expect(await callGates(root, 'run', { gate: 'typecheck' })).toMatchObject({
        status: 'pass',
        ok: true,
      });
    },
    SLOW,
  );

  it(
    'runs in a sub-folder scope of a monorepo',
    async () => {
      const root = fixtureProject({}, true);
      writeFiles(root, {
        'pkg/package.json': JSON.stringify({ name: 'pkg', scripts: { test: 'node check.js' } }),
        'pkg/check.js': "console.log('ran in pkg');\n",
      });
      const result = await callGates(root, 'run', { gate: 'test', scope: 'pkg' });
      expect(result).toMatchObject({ status: 'pass', dir: 'pkg' });
    },
    SLOW,
  );
});
