import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argv, env, exit, stdout } from 'node:process';

import { describeHeadlessOutcome, headlessExitCode } from '../core/headless-outcome';
import { inheritedEnvironment } from '../core/inherited-environment';
import { containedPath } from '../core/workspace-containment';
import { runAgent } from '../sdk/agent-sdk';

import { allowedExecutables, isAllowedExecutable } from './headless-command-policy';
import { HEADLESS_TOOLS } from './headless-tools';

import type { ToolLimits } from './headless-main.types';

/**
 * The non-interactive entry point.
 *
 * A pipeline runs this, reads the exit code, and never sees a prompt. Anything
 * that would ask a person has to be decided before the run starts, which is why
 * the tools it offers are fixed and scoped to one directory: a headless run
 * that could widen its own reach is a headless run nobody should schedule.
 *
 * Usage:
 *   node dist/headless.mjs --prompt "<task>" [--workspace <dir>] [--json]
 *
 * Exit codes are the contract in `headless-outcome.ts`. In particular 2 means
 * the run never started, which a pipeline must not confuse with a failed task.
 */
export async function main(): Promise<number> {
  const options = readOptions();
  if (options === undefined) return headlessExitCode('unusable');

  const limits: ToolLimits = {
    workspace: options.workspace,
    allowedExecutables: options.allowedExecutables,
  };
  const report = await runAgent({
    prompt: options.prompt,
    toolkit: {
      definitions: HEADLESS_TOOLS,
      execute: (call) => execute(call.toolName, call.operation, { ...call.arguments }, limits),
    },
    credentials: options.credentials,
    backendUrl: options.backendUrl,
    provider: options.provider,
    model: options.model,
    title: 'Headless run',
    deadlineMs: options.deadlineMs,
  });

  stdout.write(
    options.json
      ? `${JSON.stringify({ ...report, workspace: options.workspace })}
`
      : `${describeHeadlessOutcome(report.outcome)} ${String(report.toolCalls)} tool call(s).
`,
  );
  return headlessExitCode(report.outcome);
}

interface HeadlessOptions {
  readonly prompt: string;
  readonly workspace: string;
  readonly backendUrl: string;
  readonly provider: string;
  readonly model: string;
  readonly deadlineMs: number;
  readonly json: boolean;
  readonly allowedExecutables: readonly string[];
  readonly credentials: { email: string; password: string };
}

/**
 * Reads the invocation, and says what is missing rather than guessing.
 *
 * A headless runner that invents a default for a missing prompt or a missing
 * credential does the wrong work silently. Returning nothing here is what makes
 * the exit code 2 rather than 1.
 */
function readOptions(): HeadlessOptions | undefined {
  const prompt = flag('--prompt');
  const email = env.CLAW_LIVE_EMAIL;
  const password = env.CLAW_LIVE_PASSWORD;
  if (prompt === undefined || email === undefined || password === undefined) {
    stdout.write(
      [
        'Usage: node dist/headless.mjs --prompt "<task>" [--workspace <dir>] [--json]',
        'Requires CLAW_LIVE_EMAIL and CLAW_LIVE_PASSWORD in the environment.',
        'Optional: CLAW_LIVE_BACKEND_URL, CLAW_LIVE_PROVIDER, CLAW_LIVE_MODEL.',
        '',
      ].join('\n'),
    );
    return undefined;
  }
  return {
    prompt,
    workspace: path.resolve(flag('--workspace') ?? '.'),
    backendUrl: env.CLAW_LIVE_BACKEND_URL ?? 'https://claw.local/api/v1',
    provider: env.CLAW_LIVE_PROVIDER ?? 'ANTHROPIC',
    model: env.CLAW_LIVE_MODEL ?? 'claude-haiku-4-5-20251001',
    deadlineMs: 300_000,
    json: argv.includes('--json'),
    allowedExecutables: allowedExecutables(flags('--allow-command')),
    credentials: { email, password },
  };
}

/** Every value given for a repeatable flag, so widening is explicit and visible. */
function flags(name: string): string[] {
  const values: string[] = [];
  for (const [index, entry] of argv.entries()) {
    if (entry !== name) continue;
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith('--')) values.push(value);
  }
  return values;
}

function flag(name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function execute(
  toolName: string,
  operation: string,
  args: Record<string, unknown>,
  limits: ToolLimits,
): unknown {
  const workspace = limits.workspace;
  if (toolName === 'workspace.command') return runCommandTool(args, limits);
  const target = containedPath(workspace, typeof args.path === 'string' ? args.path : '.');
  if (operation === 'list') return { entries: readdirSync(workspace) };
  if (operation === 'read') return { content: readFileSync(target, 'utf8') };
  if (operation === 'create') {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof args.content === 'string' ? args.content : '', 'utf8');
    return { written: args.path };
  }
  throw new Error(`Unsupported operation ${operation}`);
}

/**
 * Runs a bounded command, inside the allowlist and with a built environment.
 *
 * Two boundaries, and both matter for a run nobody is watching. The allowlist
 * decides what may be spawned at all, because a run that chooses its own
 * commands can choose any command on PATH. The environment is built from
 * nothing rather than inherited, because the process running an agent is the
 * one most likely to be holding a credential, and the command the model chose
 * only has to print it.
 */
function runCommandTool(args: Record<string, unknown>, limits: ToolLimits): unknown {
  const executable = typeof args.executable === 'string' ? args.executable : '';
  if (!isAllowedExecutable(executable, limits.allowedExecutables)) {
    throw new Error(
      `Command ${executable} is not allowed. Allowed: ${limits.allowedExecutables.join(', ')}. Widen with --allow-command.`,
    );
  }
  const finished = spawnSync(executable, toStrings(args.arguments), {
    cwd: limits.workspace,
    encoding: 'utf8',
    timeout: 30_000,
    shell: false,
    env: inheritedEnvironment(env),
  });
  return {
    exitCode: finished.status ?? -1,
    stdout: captured(finished.stdout).slice(0, 4_000),
    stderr: captured(finished.stderr).slice(0, 4_000),
  };
}

/**
 * A captured stream, read as what actually arrives.
 *
 * The type declarations promise a string, and a spawn that failed or timed out
 * delivers null. Taking the value as unknown is how that stays true in the code
 * rather than only in a comment.
 */
function captured(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

/**
 * Anything thrown is a run that failed, not a runner that was misconfigured.
 *
 * Exit code 2 is reserved for an invocation the caller can fix without touching
 * anything else — a missing prompt, a missing credential. A backend that
 * refuses the start, or a stream that breaks, is a genuine failure of the
 * attempt, and reporting it as a usage error would send the reader to the wrong
 * place.
 */
try {
  exit(await main());
} catch (error) {
  stdout.write(`${error instanceof Error ? error.message : 'Headless run failed'}
`);
  exit(headlessExitCode('failed'));
}
