import { GATE_MAX_MESSAGE_CHARS } from './code-gates.constants';

import type { FailedTest } from './code-gates.types';

const VITEST_FAIL = /^\s*(?:FAIL|×)\s+(\S.*?)\s+>\s+(\S.*)$/u;
const VITEST_SUITE_FAIL = /^\s*FAIL\s+(\S+?)\s+\[\s*\S+\s*\]\s*$/u;
const VITEST_SUMMARY = /^\s*Tests\s+(.*)$/u;
const JEST_FILE = /^\s*FAIL\s+(\S+\.[cm]?[jt]sx?)\s*$/u;
const JEST_CASE = /^\s*●\s+(\S.*?)\s+›\s+(\S.*)$/u;
const JEST_SUMMARY = /^\s*Tests:\s+(.*)$/u;
const PYTEST_FAIL = /^(?:FAILED|ERROR)\s+(\S+?)::(\S+)(?:\s+-\s+(.*))?$/u;
const GO_FAIL = /^\s*--- FAIL:\s+(\S+)/u;
const GO_MESSAGE = /^\s+(\S+_test\.go):(\d+):\s*(.*)$/u;
const CARGO_FAIL = /^test\s+(\S+)\s+\.\.\.\s+FAILED$/u;
const CARGO_PANIC = /^thread '(\S+)' panicked at (\S+?):(\d+)/u;
const FAILED_COUNT = /(\d+)\s+failed/u;

/** The failed-test count a runner's own summary line states, or undefined. */
export function summaryFailed(output: string): number | undefined {
  for (const line of output.split(/\r?\n/u)) {
    const text = VITEST_SUMMARY.exec(line)?.[1] ?? JEST_SUMMARY.exec(line)?.[1];
    const count = text === undefined ? undefined : FAILED_COUNT.exec(text)?.[1];
    if (count !== undefined) return Number(count);
  }
  return undefined;
}

function cut(text: string): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length <= GATE_MAX_MESSAGE_CHARS
    ? flat
    : `${flat.slice(0, GATE_MAX_MESSAGE_CHARS - 1)}…`;
}

/** The first line after `index` that says something: not blank, not a stack frame or a code frame. */
function messageAfter(lines: readonly string[], index: number): string {
  const collected: string[] = [];
  for (const line of lines.slice(index + 1, index + 12)) {
    const text = line.trim();
    if (text.length === 0) {
      if (collected.length > 0) break;
      continue;
    }
    if (/^(?:FAIL|✓|×|❯|at\s|\d+\||>\s*\d+\|)/u.test(text) || /^[-=]{3,}/u.test(text)) {
      if (collected.length > 0) break;
      continue;
    }
    collected.push(text);
    if (collected.length === 2) break;
  }
  return cut(collected.join(' '));
}

function vitestFailures(lines: readonly string[]): readonly FailedTest[] {
  const failures: FailedTest[] = [];
  for (const [index, line] of lines.entries()) {
    const test = VITEST_FAIL.exec(line);
    if (test !== null) {
      failures.push({
        file: test[1] ?? '',
        name: cut(test[2] ?? ''),
        message: messageAfter(lines, index),
      });
      continue;
    }
    const suite = VITEST_SUITE_FAIL.exec(line);
    if (suite !== null) {
      failures.push({
        file: suite[1] ?? '',
        name: '(suite failed to run)',
        message: messageAfter(lines, index),
      });
    }
  }
  return failures;
}

function jestFailures(lines: readonly string[]): readonly FailedTest[] {
  const failures: FailedTest[] = [];
  let file = '';
  for (const [index, line] of lines.entries()) {
    file = JEST_FILE.exec(line)?.[1] ?? file;
    const test = JEST_CASE.exec(line);
    if (test !== null) {
      failures.push({
        file,
        name: cut(`${test[1] ?? ''} › ${test[2] ?? ''}`),
        message: messageAfter(lines, index),
      });
    }
  }
  return failures;
}

function pytestFailures(lines: readonly string[]): readonly FailedTest[] {
  return lines.flatMap((line) => {
    const match = PYTEST_FAIL.exec(line);
    if (match === null) return [];
    return [{ file: match[1] ?? '', name: match[2] ?? '', message: cut(match[3] ?? '') }];
  });
}

function goFailures(lines: readonly string[]): readonly FailedTest[] {
  const failures: FailedTest[] = [];
  for (const [index, line] of lines.entries()) {
    const name = GO_FAIL.exec(line)?.[1];
    if (name === undefined) continue;
    const detail = lines
      .slice(index + 1, index + 6)
      .map((next) => GO_MESSAGE.exec(next))
      .find((match) => match !== null);
    failures.push({
      file: detail?.[1] ?? '',
      name,
      message: cut(detail?.[3] ?? ''),
    });
  }
  return failures;
}

function cargoFailures(lines: readonly string[]): readonly FailedTest[] {
  const failures: FailedTest[] = [];
  const places = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    const panic = CARGO_PANIC.exec(line);
    if (panic !== null)
      places.set(
        panic[1] ?? '',
        `${panic[2] ?? ''}:${panic[3] ?? ''} ${messageAfter(lines, index)}`,
      );
  }
  for (const line of lines) {
    const name = CARGO_FAIL.exec(line)?.[1];
    if (name === undefined) continue;
    const place = places.get(name) ?? '';
    const [file = '', ...rest] = place.split(' ');
    failures.push({ file, name, message: cut(rest.join(' ')) });
  }
  return failures;
}

/** Failing tests from vitest, jest, pytest, `go test` and `cargo test` output, each listed once. */
export function parseFailedTests(output: string): readonly FailedTest[] {
  const lines = output.split(/\r?\n/u);
  const all = [
    ...vitestFailures(lines),
    ...jestFailures(lines),
    ...pytestFailures(lines),
    ...goFailures(lines),
    ...cargoFailures(lines),
  ];
  const seen = new Set<string>();
  return all.filter((test) => {
    const key = `${test.file}\u0000${test.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
