import { describe, expect, it } from 'vitest';

import { missingToolReason, summarizeOutput } from '../../src/sdk/code-gates-parse';

describe('summarizeOutput: compilers and linters', () => {
  it('reads tsc errors with file, position and code', () => {
    const output = [
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/b.ts(10,1): error TS2304: Cannot find name 'zzz'.",
      'Found 2 errors in 2 files.',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.errors).toBe(2);
    expect(summary.issues[0]).toBe(
      "src/a.ts:3:7 TS2322 Type 'string' is not assignable to type 'number'.",
    );
  });

  it('reads tsc output in the colon format too', () => {
    const summary = summarizeOutput("src/a.ts:3:7 - error TS2322: Type 'string' is bad.");
    expect(summary.errors).toBe(1);
    expect(summary.issues[0]).toContain('src/a.ts:3:7 TS2322');
  });

  it('reads eslint stylish output, counting warnings apart', () => {
    const output = [
      '/work/src/a.ts',
      '  1:5  error    Unexpected var, use let or const instead  no-var',
      '  2:9  warning  Expected === and instead saw ==            eqeqeq',
      '',
      '✖ 2 problems (1 error, 1 warning)',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.issues[0]).toBe(
      '/work/src/a.ts:1:5 Unexpected var, use let or const instead (no-var)',
    );
  });

  it('reads eslint JSON output', () => {
    const json = JSON.stringify([
      {
        filePath: '/w/a.ts',
        messages: [{ line: 4, column: 2, severity: 2, message: 'No good', ruleId: 'x/y' }],
      },
    ]);
    const summary = summarizeOutput(json);
    expect(summary.errors).toBe(1);
    expect(summary.issues[0]).toBe('/w/a.ts:4:2 No good (x/y)');
  });

  it('lists the files prettier --check flags', () => {
    const output = [
      'Checking formatting...',
      '[warn] src/a.ts',
      '[warn] src/b.ts',
      '[warn] Code style issues found in 2 files. Run Prettier with --write to fix.',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.errors).toBe(2);
    expect(summary.issues).toEqual(['src/a.ts is not formatted', 'src/b.ts is not formatted']);
  });

  it('reads cargo errors with their location', () => {
    const output = [
      'error[E0308]: mismatched types',
      ' --> src/main.rs:4:18',
      'error: could not compile `x` due to 1 previous error',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.errors).toBe(1);
    expect(summary.issues[0]).toBe('src/main.rs:4:18 E0308 mismatched types');
  });

  it('reads go compile errors', () => {
    const summary = summarizeOutput('./main.go:7:2: undefined: foo\n');
    expect(summary.errors).toBe(1);
    expect(summary.issues[0]).toBe('./main.go:7 undefined: foo');
  });

  it('treats every line gofmt -l prints as a file needing formatting', () => {
    const summary = summarizeOutput('a.go\nb.go\n', true);
    expect(summary.errors).toBe(2);
    expect(summary.issues[1]).toBe('b.go needs formatting');
  });

  it('strips colour codes before reading', () => {
    const summary = summarizeOutput('\u001b[31msrc/a.ts(1,1): error TS1005: oops\u001b[39m');
    expect(summary.errors).toBe(1);
  });

  it('reports nothing for clean output', () => {
    expect(summarizeOutput('all good\n')).toEqual({
      errors: 0,
      warnings: 0,
      failedTests: [],
      issues: [],
    });
  });

  it('caps the issue list but keeps the full error count', () => {
    const lines = Array.from(
      { length: 40 },
      (_, i) => `src/a.ts(${String(i + 1)},1): error TS1: bad`,
    );
    const summary = summarizeOutput(lines.join('\n'));
    expect(summary.errors).toBe(40);
    expect(summary.issues).toHaveLength(8);
  });

  it('cuts a very long message to 200 characters', () => {
    const summary = summarizeOutput(`src/a.ts(1,1): error TS1: ${'x'.repeat(2000)}`);
    expect(summary.issues[0]?.length).toBeLessThanOrEqual(200);
  });
});

describe('summarizeOutput: tests', () => {
  it('reads vitest failures with file, name and message', () => {
    const output = [
      ' FAIL  src/math.test.ts > adds',
      'AssertionError: expected 3 to be 4 // Object.is equality',
      '',
      '- Expected',
      '+ Received',
      ' ❯ src/math.test.ts:5:23',
      '',
      ' Test Files  1 failed (1)',
      '      Tests  1 failed | 2 passed (3)',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.errors).toBe(1);
    expect(summary.failedTests).toEqual([
      {
        file: 'src/math.test.ts',
        name: 'adds',
        message: 'AssertionError: expected 3 to be 4 // Object.is equality',
      },
    ]);
  });

  it('lists a vitest failure once even when it is printed twice', () => {
    const block = ' FAIL  a.test.ts > one\nError: boom\n';
    expect(summarizeOutput(`${block}\n${block}`).failedTests).toHaveLength(1);
  });

  it('reads a suite that failed to load', () => {
    const output = ' FAIL  src/x.test.ts [ src/x.test.ts ]\nError: Cannot find module ./nope\n';
    const summary = summarizeOutput(output);
    expect(summary.failedTests[0]).toMatchObject({
      file: 'src/x.test.ts',
      name: '(suite failed to run)',
    });
    expect(summary.failedTests[0]?.message).toContain('Cannot find module');
  });

  it('reads jest failures', () => {
    const output = [
      'FAIL src/a.test.js',
      '  ● math › adds',
      '',
      '    expect(received).toBe(expected)',
      '',
      'Tests:       1 failed, 2 passed, 3 total',
    ].join('\n');
    const summary = summarizeOutput(output);
    expect(summary.failedTests[0]).toMatchObject({ file: 'src/a.test.js', name: 'math › adds' });
    expect(summary.errors).toBe(1);
  });

  it('uses the runner summary when it counts more failures than were listed', () => {
    const output = ' FAIL  a.test.ts > one\nError: x\n      Tests  5 failed | 2 passed (7)';
    expect(summarizeOutput(output).errors).toBe(5);
  });

  it('reads pytest failures', () => {
    const summary = summarizeOutput('FAILED tests/test_a.py::test_x - assert 1 == 2\n');
    expect(summary.failedTests[0]).toEqual({
      file: 'tests/test_a.py',
      name: 'test_x',
      message: 'assert 1 == 2',
    });
  });

  it('reads go test failures', () => {
    const output = '--- FAIL: TestAdd (0.00s)\n    add_test.go:9: got 3, want 4\nFAIL\n';
    expect(summarizeOutput(output).failedTests[0]).toEqual({
      file: 'add_test.go',
      name: 'TestAdd',
      message: 'got 3, want 4',
    });
  });

  it('reads cargo test failures with their panic location', () => {
    const output = [
      'test tests::adds ... FAILED',
      "thread 'tests::adds' panicked at src/lib.rs:12:9:",
      'assertion failed: left == right',
    ].join('\n');
    expect(summarizeOutput(output).failedTests[0]).toMatchObject({
      name: 'tests::adds',
      file: 'src/lib.rs:12',
    });
  });
});

describe('missingToolReason', () => {
  it('recognises a script the package does not have', () => {
    expect(missingToolReason('npm error Missing script: "lint"')).toContain('no such script');
  });

  it('recognises a tool that is not installed', () => {
    expect(missingToolReason('npm error npx canceled due to missing packages')).toContain(
      'not installed',
    );
  });

  it('says nothing about an ordinary failure', () => {
    expect(missingToolReason('src/a.ts(1,1): error TS1: x')).toBeUndefined();
  });
});
