import { readFileSync, statSync } from 'node:fs';

import { headlessExitCode } from '../core/headless-outcome';
import { redactText } from '../core/redaction';
import { orchestrate } from '../sdk/orchestrate';
import { describePlan } from '../sdk/orchestrate-format';
import { defaultCeiling, validatePlan } from '../sdk/orchestrate-validate';

import { approvalFrom } from './headless-approval';
import { authFromEnvironment } from './headless-args';
import { parseOrchestrateArgs } from './orchestrate-args';
import { ORCHESTRATE_PLAN_MAX_BYTES, ORCHESTRATE_USAGE } from './orchestrate-cli.constants';
import { orchestrateEventLine } from './orchestrate-output';

import type { HeadlessEnvironment, HeadlessIo } from './headless-args.types';
import type { OrchestrateInvocation } from './orchestrate-args';
import type { RuntimeTransportPort } from '../sdk/agent-sdk.types';
import type { AgentFactory } from '../sdk/agent-team-tool.types';
import type { OrchestrateOutcome } from '../sdk/orchestrate';
import type { OrchestrateCeiling, OrchestrateOptions } from '../sdk/orchestrate.types';

/** What the process (or a test) supplies. */
export interface OrchestrateContext {
  readonly cwd: string;
  readonly signal?: AbortSignal | undefined;
  readonly transport?: RuntimeTransportPort | undefined;
  readonly factory?: AgentFactory | undefined;
  readonly stateDirectory?: string | undefined;
}

/** The exit code of a finished run: the shared contract, with a time limit read as an exhausted budget. */
export function exitCodeFor(status: 'passed' | 'failed' | 'cancelled' | 'timeout'): number {
  if (status === 'passed') return headlessExitCode('completed');
  if (status === 'cancelled') return headlessExitCode('cancelled');
  return headlessExitCode(status === 'timeout' ? 'exhausted' : 'failed');
}

function usage(io: HeadlessIo, message: string): number {
  io.stderr(`${redactText(message)}\n\n${ORCHESTRATE_USAGE}`);
  return headlessExitCode('unusable');
}

/** The plan file's JSON, or the message saying why it cannot be read. */
function readPlan(
  file: string,
  maxParallel: number | undefined,
): { plan: unknown } | { problem: string } {
  try {
    if (statSync(file).size > ORCHESTRATE_PLAN_MAX_BYTES)
      return { problem: `The plan file is over ${String(ORCHESTRATE_PLAN_MAX_BYTES)} bytes.` };
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (
      maxParallel !== undefined &&
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return { plan: { ...parsed, maxParallel } };
    }
    return { plan: parsed };
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'is not valid JSON' : 'cannot be read';
    return {
      problem: `The plan file ${file} ${reason}${error instanceof SyntaxError ? `: ${error.message}` : '.'}`,
    };
  }
}

function ceilingOf(invocation: OrchestrateInvocation): OrchestrateCeiling {
  return defaultCeiling({
    allow: invocation.allowTools,
    shell: invocation.allowShell,
    httpAllowHosts: invocation.httpAllowHosts,
    browserAllowHosts: invocation.browserAllowHosts,
  });
}

function dryRun(plan: unknown, invocation: OrchestrateInvocation, io: HeadlessIo): number {
  const checked = validatePlan(plan, ceilingOf(invocation));
  if (!checked.ok) {
    io.stderr(`${checked.problems.map((problem) => `- ${redactText(problem)}`).join('\n')}\n`);
    return headlessExitCode('unusable');
  }
  const { value } = checked;
  io.stdout(
    invocation.outputFormat === 'text'
      ? describePlan(value)
      : `${JSON.stringify({ ok: true, order: value.order, waves: value.waves, parallelPairs: value.parallelPairs, warnings: value.warnings })}\n`,
  );
  return 0;
}

function optionsFor(
  invocation: OrchestrateInvocation,
  auth: NonNullable<ReturnType<typeof authFromEnvironment>>,
  io: HeadlessIo,
  context: OrchestrateContext,
): OrchestrateOptions {
  const stream = invocation.outputFormat === 'stream-json';
  return {
    config: {
      auth,
      backendUrl: invocation.backendUrl,
      model: invocation.model,
      provider: invocation.provider,
      permissions: {
        allow: invocation.allowTools,
        allowedExecutables: invocation.allowCommands,
        ...(invocation.allowShell ? { shell: { deny: invocation.shellDeny } } : {}),
        ...(invocation.permissionMode === undefined ? {} : { approve: approvalFrom(io) }),
      },
      permissionMode: invocation.permissionMode,
      transport: context.transport,
    },
    ceiling: ceilingOf(invocation),
    cwd: context.cwd,
    signal: context.signal,
    stateDirectory: context.stateDirectory,
    factory: context.factory,
    onEvent: (event) => {
      if (stream) io.stdout(`${redactText(JSON.stringify(event))}\n`);
      else if (invocation.outputFormat === 'text') io.stderr(orchestrateEventLine(event));
    },
  };
}

/** Prints the closing output of a run that happened and returns its exit code. */
function summarize(
  outcome: Extract<OrchestrateOutcome, { ok: true }>,
  invocation: OrchestrateInvocation,
  io: HeadlessIo,
): number {
  const { report } = outcome;
  const format = invocation.outputFormat;
  if (format === 'json')
    io.stdout(`${redactText(JSON.stringify(report))}
`);
  if (format === 'text') {
    io.stdout(`${report.plan.name}: ${report.status}${report.reason === undefined ? '' : `. ${report.reason}`}
`);
  }
  if (outcome.reportError !== undefined) {
    io.stderr(`The report could not be written: ${redactText(outcome.reportError)}
`);
  } else if (report.directory !== undefined && format !== 'json') {
    io.stderr(`report ${report.directory}
`);
  }
  return exitCodeFor(report.status);
}

/**
 * `clawai orchestrate --plan plan.json`: the whole command, with the process
 * supplied from outside so every path (usage, refused plan, no sign-in, pass,
 * fail, cancel) is testable without spawning. Returns the exit code.
 */
export async function runOrchestrateCli(
  argv: readonly string[],
  environment: HeadlessEnvironment,
  io: HeadlessIo,
  context: OrchestrateContext,
): Promise<number> {
  const parsed = parseOrchestrateArgs(argv, environment, context.cwd);
  if (parsed.kind === 'help') {
    io.stdout(ORCHESTRATE_USAGE);
    return 0;
  }
  if (parsed.kind === 'usage') return usage(io, parsed.message);
  const { invocation } = parsed;
  const read = readPlan(invocation.planFile, invocation.maxParallel);
  if ('problem' in read) return usage(io, read.problem);
  if (invocation.dryRun) return dryRun(read.plan, invocation, io);
  const auth = authFromEnvironment(environment);
  if (auth === undefined) {
    io.stderr('No credential: set CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD.\n');
    return headlessExitCode('unauthenticated');
  }
  const outcome = await orchestrate(read.plan, optionsFor(invocation, auth, io, context));
  if (!outcome.ok) {
    io.stderr(`${outcome.problems.map((problem) => `- ${redactText(problem)}`).join('\n')}\n`);
    return headlessExitCode('unusable');
  }
  return summarize(outcome, invocation, io);
}
