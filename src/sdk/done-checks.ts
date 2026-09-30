import { existsSync } from 'node:fs';
import { env, platform } from 'node:process';

import { redactText } from '../core/redaction';
import { containedPath } from '../core/workspace-containment';

import { runForeground } from './command-tool-foreground';
import { headAndTail } from './command-tool-output';
import {
  DONE_CHECK_DEFAULT_TIMEOUT_MS,
  DONE_CHECK_MAX_ARGUMENTS,
  DONE_CHECK_MAX_COUNT,
  DONE_CHECK_MAX_LABEL_CHARS,
  DONE_CHECK_MAX_TIMEOUT_MS,
  DONE_CHECK_NO_EXIT_CODE,
  DONE_CHECK_OUTPUT_CHARS,
  DONE_CHECKS_PROMPT_HEAD,
  DONE_CHECKS_PROMPT_TAIL,
} from './done-checks.constants';

import type { CommandResult, CommandRuntime } from './command-tool.types';
import type {
  DoneCheck,
  DoneCheckOutcome,
  DoneCheckRunner,
  DoneCheckSummary,
  DoneChecksReport,
} from './done-checks.types';

const HOST_RUNTIME: CommandRuntime = { platform, environment: env, exists: existsSync };

/** The message naming what is wrong with one check, or undefined when it is usable. */
export function doneCheckProblem(check: DoneCheck): string | undefined {
  const label = check.label.trim();
  if (label.length === 0 || label.length > DONE_CHECK_MAX_LABEL_CHARS) {
    return `A check label is 1 to ${String(DONE_CHECK_MAX_LABEL_CHARS)} characters.`;
  }
  if (check.executable.trim().length === 0) return `Check "${label}" has no executable.`;
  if (check.args.length > DONE_CHECK_MAX_ARGUMENTS) {
    return `Check "${label}" has more than ${String(DONE_CHECK_MAX_ARGUMENTS)} arguments.`;
  }
  const { timeoutMs } = check;
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DONE_CHECK_MAX_TIMEOUT_MS)
  ) {
    return `Check "${label}": timeoutMs is a whole number from 1 to ${String(DONE_CHECK_MAX_TIMEOUT_MS)}.`;
  }
  return undefined;
}

/** The first problem in a list of checks, or undefined. Labels must be distinct. */
export function doneChecksProblem(checks: readonly DoneCheck[]): string | undefined {
  if (checks.length > DONE_CHECK_MAX_COUNT) {
    return `At most ${String(DONE_CHECK_MAX_COUNT)} completion checks are allowed.`;
  }
  const labels = new Set<string>();
  for (const check of checks) {
    const problem = doneCheckProblem(check);
    if (problem !== undefined) return problem;
    if (labels.has(check.label.trim())) return `Two checks are both labelled "${check.label}".`;
    labels.add(check.label.trim());
  }
  return undefined;
}

function outputOf(result: CommandResult, note: string | undefined): string {
  const parts = [note ?? '', result.stdout, result.stderr].filter((part) => part.length > 0);
  return redactText(headAndTail(parts.join('\n'), DONE_CHECK_OUTPUT_CHARS).text);
}

function outcomeOf(check: DoneCheck, result: CommandResult): DoneCheckOutcome {
  const exited = !result.timedOut && !result.aborted && result.error === undefined;
  const note = result.timedOut
    ? `Timed out after ${String(check.timeoutMs ?? DONE_CHECK_DEFAULT_TIMEOUT_MS)} ms and was killed.`
    : result.aborted
      ? 'Cancelled before it finished.'
      : result.error;
  return {
    label: check.label,
    ok: exited && result.exitCode === 0,
    exitCode: exited ? result.exitCode : DONE_CHECK_NO_EXIT_CODE,
    durationMs: result.durationMs,
    output: outputOf(result, note),
  };
}

function failure(check: DoneCheck, startedAt: number, error: unknown): DoneCheckOutcome {
  const message = error instanceof Error ? error.message : 'The check could not start.';
  return {
    label: check.label,
    ok: false,
    exitCode: DONE_CHECK_NO_EXIT_CODE,
    durationMs: Date.now() - startedAt,
    output: redactText(message),
  };
}

/**
 * Runs one check the way a command runs: no shell, stdin closed, the filtered
 * environment, the hardened spawn, both ends of the output kept. It does not go
 * through the model's toolkit, so the allowlist, write scope and permission
 * mode do not apply: the caller wrote the check.
 */
async function runCheck(
  check: DoneCheck,
  workspace: string,
  signal: AbortSignal | undefined,
  runtime: CommandRuntime,
): Promise<DoneCheckOutcome> {
  const startedAt = Date.now();
  try {
    const cwd = containedPath(workspace, check.cwd ?? '.');
    const result = await runForeground(
      {
        executable: check.executable,
        arguments: check.args,
        cwd,
        timeoutMs: check.timeoutMs ?? DONE_CHECK_DEFAULT_TIMEOUT_MS,
        maxOutputChars: DONE_CHECK_OUTPUT_CHARS,
        background: false,
      },
      runtime,
      signal,
    );
    return outcomeOf(check, result);
  } catch (error) {
    return failure(check, startedAt, error);
  }
}

/**
 * Runs every check, in order, and all of them: the orchestrator wants each
 * failure at once, not the first. Checks run after the model's last tool call,
 * in the same workspace, so they should verify state (git history, tests, files
 * that must exist) and not anything the model could have merely said.
 */
export async function runDoneChecks(
  checks: readonly DoneCheck[],
  workspace: string,
  signal: AbortSignal | undefined,
  runtime: CommandRuntime = HOST_RUNTIME,
): Promise<DoneChecksReport> {
  const outcomes: DoneCheckOutcome[] = [];
  for (const check of checks) {
    outcomes.push(await runCheck(check, workspace, signal, runtime));
  }
  return { passed: outcomes.every((outcome) => outcome.ok), checks: outcomes };
}

/** A runner bound to the workspace, or undefined when no check is configured. */
export function doneCheckRunner(
  checks: readonly DoneCheck[] | undefined,
  workspace: string,
): DoneCheckRunner | undefined {
  if (checks === undefined || checks.length === 0) return undefined;
  return (signal) => runDoneChecks(checks, workspace, signal);
}

/** What a result carries about the checks: no output, which can be long. */
export function checkSummaries(report: DoneChecksReport): readonly DoneCheckSummary[] {
  return report.checks.map(({ label, ok, exitCode }) => ({ label, ok, exitCode }));
}

/** The continuation prompt for a failed report: each failing check and the ends of its output. */
export function doneChecksPrompt(report: DoneChecksReport): string {
  const failing = report.checks
    .filter((outcome) => !outcome.ok)
    .map((outcome) => `${outcome.label}: exit ${String(outcome.exitCode)}; ${outcome.output}`);
  return `${DONE_CHECKS_PROMPT_HEAD} Failing checks:\n${failing.join('\n')}\n${DONE_CHECKS_PROMPT_TAIL}`;
}

/** The labels of the checks that failed. */
export function failingLabels(report: DoneChecksReport): readonly string[] {
  return report.checks.filter((outcome) => !outcome.ok).map((outcome) => outcome.label);
}
