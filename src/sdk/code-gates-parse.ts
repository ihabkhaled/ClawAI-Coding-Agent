import { toTerminalSafeText } from '../core/terminal-output';

import { parseProblems } from './code-gates-parse-problems';
import { parseFailedTests, summaryFailed } from './code-gates-parse-tests';
import { GATE_MAX_ISSUES, GATE_MAX_MESSAGE_CHARS } from './code-gates.constants';

import type { GateSummary } from './code-gates.types';

/** Output with colour codes and other control characters removed; the readers match plain text. */
export function plainText(output: string): string {
  return toTerminalSafeText(output).text.replaceAll('\r\n', '\n');
}

/** Output lines of a tool that lists offending files and exits 0 (`gofmt -l`). */
function listedFiles(output: string): readonly string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${line.slice(0, GATE_MAX_MESSAGE_CHARS)} needs formatting`);
}

/**
 * Reads a gate's output into counts and the first few findings.
 *
 * Errors are findings of severity error plus failed tests; a runner's own
 * summary line wins over the list when it counts more, since the list is of
 * what could be recognised and the summary is of what ran.
 */
export function summarizeOutput(rawOutput: string, failOnOutput = false): GateSummary {
  const output = plainText(rawOutput);
  if (failOnOutput) {
    const files = listedFiles(output);
    return {
      errors: files.length,
      warnings: 0,
      failedTests: [],
      issues: files.slice(0, GATE_MAX_ISSUES),
    };
  }
  const problems = parseProblems(output);
  const failed = parseFailedTests(output);
  const failedCount = Math.max(summaryFailed(output) ?? 0, failed.length);
  const errors = problems.filter((problem) => problem.severity === 'error');
  const warnings = problems.length - errors.length;
  return {
    errors: errors.length + failedCount,
    warnings,
    failedTests: failed.slice(0, GATE_MAX_ISSUES),
    issues: [...errors, ...problems.filter((problem) => problem.severity === 'warning')]
      .slice(0, GATE_MAX_ISSUES)
      .map((problem) => problem.text),
  };
}

/** The reasons a tool is simply not there, as the package managers and shells word them. */
const MISSING_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/Missing script:\s*["']?([\w:.-]+)/iu, 'the package has no such script'],
  [
    /canceled due to missing packages|could not determine executable to run/iu,
    'the tool is not installed (run the install step first)',
  ],
  [
    /is not recognized as an internal or external command|command not found|not found in PATH|:\s+not found/iu,
    'the program is not installed',
  ],
  [/ERR_PNPM_NO_SCRIPT|error Command ".+" not found/iu, 'the package has no such script'],
];

/** Why the command never really ran (a missing script or tool), or undefined. */
export function missingToolReason(output: string): string | undefined {
  const text = plainText(output);
  for (const [pattern, reason] of MISSING_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return undefined;
}
