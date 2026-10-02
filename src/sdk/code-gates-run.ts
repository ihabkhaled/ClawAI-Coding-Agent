import path from 'node:path';

import { redactText } from '../core/redaction';
import { isAllowedExecutable } from '../headless/headless-command-policy';

import { missingToolReason, plainText, summarizeOutput } from './code-gates-parse';
import {
  GATE_FLAKY_RERUN_FILES,
  GATE_PARSE_OUTPUT_CHARS,
  GATE_TAIL_CHARS,
} from './code-gates.constants';
import { runForeground } from './command-tool-foreground';

import type {
  GateCommand,
  GateName,
  GateProject,
  GateResult,
  GateSummary,
} from './code-gates.types';
import type { CommandResult, CommandRuntime } from './command-tool.types';

/** What one gate run needs; `files` are relative to the project folder. */
export interface RunGateInput {
  readonly gate: GateName;
  readonly project: GateProject;
  readonly workspace: string;
  readonly files: readonly string[];
  readonly timeoutMs: number;
  readonly allowed: readonly string[];
  readonly runtime: CommandRuntime;
  readonly signal: AbortSignal | undefined;
}

const UNVERIFIED_NOTE = 'not verified: say so in your final answer, do not call it passed';

const NO_SUMMARY: GateSummary = { errors: 0, warnings: 0, failedTests: [], issues: [] };

/** A gate that could not run. It is never a pass: `ok` is false and `reason` says why. */
export function unavailableResult(
  gate: GateName,
  dir: string,
  command: string,
  reason: string,
): GateResult {
  return {
    gate,
    dir,
    command,
    status: 'unavailable',
    ok: false,
    exitCode: -1,
    durationMs: 0,
    summary: NO_SUMMARY,
    tail: '',
    reason,
    note: UNVERIFIED_NOTE,
  };
}

function unavailable(input: RunGateInput, command: string, reason: string): GateResult {
  return unavailableResult(input.gate, input.project.dir, command, reason);
}

/** The command to run: the narrowed direct tool when files were given and one exists. */
function chosenCommand(input: RunGateInput): { command: GateCommand | undefined; note?: string } {
  const { gate, project, files } = input;
  if (files.length === 0) return { command: project.gates[gate] };
  const direct = project.fileGates[gate];
  if (direct !== undefined) {
    return { command: { ...direct, args: [...direct.args, ...files] } };
  }
  return {
    command: project.gates[gate],
    note: `files ignored: ${gate} has no per-file form here, so the whole folder ran`,
  };
}

function outputOf(result: CommandResult): string {
  return [result.stdout, result.stderr].filter((part) => part.length > 0).join('\n');
}

function tailOf(output: string, summary: GateSummary): string {
  if (summary.issues.length > 0 || summary.failedTests.length > 0) return '';
  return redactText(plainText(output).trim().slice(-GATE_TAIL_CHARS));
}

async function execute(input: RunGateInput, command: GateCommand): Promise<CommandResult | string> {
  const cwd = path.resolve(input.workspace, input.project.dir);
  try {
    return await runForeground(
      {
        executable: command.executable,
        arguments: command.args,
        cwd,
        timeoutMs: input.timeoutMs,
        maxOutputChars: GATE_PARSE_OUTPUT_CHARS,
        background: false,
      },
      input.runtime,
      input.signal,
    );
  } catch (error) {
    return error instanceof Error ? error.message : 'the command could not start';
  }
}

/** A finding can quote a line of the program's own output, so it is redacted like the tail. */
function redactedSummary(summary: GateSummary, folder: string): GateSummary {
  const shown = (text: string): string => redactText(relativeTo(text, folder));
  return {
    ...summary,
    issues: summary.issues.map(shown),
    failedTests: summary.failedTests.map((test) => ({
      name: shown(test.name),
      file: shown(test.file),
      message: shown(test.message),
    })),
  };
}

/** Paths in a finding relative to the folder the gate ran in: shorter, and no machine layout. */
function relativeTo(text: string, folder: string): string {
  const forward = folder.split(path.sep).join('/');
  return text.replaceAll(`${folder}${path.sep}`, '').replaceAll(`${forward}/`, '');
}

function resultOf(
  input: RunGateInput,
  command: GateCommand,
  result: CommandResult,
  note: string | undefined,
): GateResult {
  const output = outputOf(result);
  const missing = result.exitCode !== 0 ? missingToolReason(output) : undefined;
  if (missing !== undefined) return unavailable(input, command.display, missing);
  const summary = redactedSummary(
    summarizeOutput(output, command.failOnOutput === true),
    path.resolve(input.workspace, input.project.dir),
  );
  const listedOffenders = command.failOnOutput === true && summary.errors > 0;
  const passed = result.exitCode === 0 && !result.timedOut && !result.aborted && !listedOffenders;
  return {
    gate: input.gate,
    dir: input.project.dir,
    command: command.display,
    status: result.timedOut ? 'timeout' : passed ? 'pass' : 'fail',
    ok: passed,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    summary,
    tail: passed ? '' : tailOf(output, summary),
    ...(note === undefined ? {} : { note }),
  };
}

/** The test files that failed, project-relative and unique, for a one-time re-run. */
function failingFiles(result: GateResult): readonly string[] {
  const files = result.summary.failedTests
    .map((test) => test.file)
    .filter((file) => file.length > 0);
  return [...new Set(files)].slice(0, GATE_FLAKY_RERUN_FILES);
}

/** Re-runs only the failing test files once; a pass the second time is flaky, not fixed. */
async function recheck(input: RunGateInput, first: GateResult): Promise<GateResult> {
  const files = failingFiles(first);
  if (first.status !== 'fail' || input.gate !== 'test' || files.length === 0) return first;
  if (input.project.fileGates.test === undefined) return first;
  const again = await runOnce({ ...input, files });
  if (again.status !== 'pass') return first;
  return {
    ...first,
    ok: true,
    status: 'pass',
    flaky: true,
    note: `flaky?: ${String(files.length)} failing file(s) passed when re-run alone; the first run failed`,
  };
}

async function runOnce(input: RunGateInput): Promise<GateResult> {
  const { command, note } = chosenCommand(input);
  if (command === undefined) {
    return unavailable(input, '', `no ${input.gate} command found (no script or tool detected)`);
  }
  if (!isAllowedExecutable(command.executable, input.allowed)) {
    return unavailable(
      input,
      command.display,
      `${command.executable} is not on the command allowlist; the operator can add it with --allow-command ${command.executable}`,
    );
  }
  const result = await execute(input, command);
  if (typeof result === 'string') return unavailable(input, command.display, result);
  if (result.error !== undefined) return unavailable(input, command.display, result.error);
  return resultOf(input, command, result, note);
}

/** Runs one gate in one project and returns the short, structured result. */
export async function runGate(input: RunGateInput): Promise<GateResult> {
  return recheck(input, await runOnce(input));
}
