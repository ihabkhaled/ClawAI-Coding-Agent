import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { plainRelativeFiles, projectFiles, requestedFiles } from '../../src/sdk/code-gates-files';
import { summarizeOutput } from '../../src/sdk/code-gates-parse';

import { callGates, cleanUpFixtures, emptyFolder, writeFiles } from './code-gates.helpers';

cleanUpFixtures();

describe('code.gates arguments cannot become flags', () => {
  it('refuses a name that only turns into a flag once ".." is resolved', () => {
    const root = emptyFolder();
    expect(() => requestedFiles(['a/../--fix'], root)).toThrow(/does not start with "-"/u);
    expect(() => requestedFiles(['./--config'], root)).toThrow(/does not start with "-"/u);
  });

  it('puts ./ in front of a project-relative name that starts with a dash', () => {
    const root = emptyFolder();
    expect(projectFiles(root, 'pkg', ['pkg/-odd.ts', 'pkg/src/a.ts'])).toEqual([
      './-odd.ts',
      'src/a.ts',
    ]);
  });

  it('keeps only plain relative files from a runner output, never a flag or an escape', () => {
    expect(
      plainRelativeFiles([
        'src/a.test.ts',
        '--update',
        '-u',
        '../../etc/passwd',
        'C:\\x\\y.ts',
        '/etc/passwd',
        'a\nb',
        'a/../../b',
      ]),
    ).toEqual(['src/a.test.ts']);
  });
});

describe('code.gates reports what the exit code says', () => {
  const scripted = (program: string): string => {
    const root = emptyFolder();
    writeFiles(root, {
      'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node print.js' } }),
      'print.js': program,
    });
    return root;
  };

  it('is a failure when the runner prints a pass summary and exits 1', async () => {
    const root = scripted("console.log(' Tests  12 passed (12)'); process.exit(1);");
    const result = await callGates(root, 'run', { gate: 'test' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('fail');
  });

  it('is ok on exit 0 but says so when the output lists failures', async () => {
    const root = scripted(
      "console.log(' FAIL  src/a.test.ts > adds'); console.log(' Tests  1 failed | 2 passed (3)'); process.exit(0);",
    );
    const result = await callGates(root, 'run', { gate: 'test' });
    expect(result.ok).toBe(true);
    expect(String(result.note)).toMatch(/exit code 0, but the output lists/u);
  });

  it('never executes project code on detect', async () => {
    const root = emptyFolder();
    const marker = path.join(root, 'RAN').split(path.sep).join('/');
    const program = `require('fs').writeFileSync('${marker}','x')`;
    writeFiles(root, {
      'package.json': JSON.stringify({
        name: 'h',
        scripts: { test: 'node hostile.js', lint: 'node hostile.js' },
        devDependencies: { eslint: '1', vitest: '1' },
      }),
      'hostile.js': program,
      'eslint.config.js': program,
      'vitest.config.js': program,
    });
    await callGates(root, 'detect', {});
    await callGates(root, 'report', {});
    expect(existsSync(path.join(root, 'RAN'))).toBe(false);
  });

  it('parses hostile output quickly', () => {
    const inputs = [
      'a'.repeat(400_000),
      'x:1:1: '.repeat(50_000),
      'FAIL '.repeat(80_000),
      `a ${' '.repeat(5_000)}\n`.repeat(80),
      '\n'.repeat(400_000),
    ];
    const began = Date.now();
    for (const input of inputs) summarizeOutput(input);
    expect(Date.now() - began).toBeLessThan(5_000);
  });
});
