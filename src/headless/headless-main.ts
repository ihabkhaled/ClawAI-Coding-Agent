import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { argv, env, exit, stdout } from 'node:process';

import { describeHeadlessOutcome, headlessExitCode } from '../core/headless-outcome';

import { runHeadlessSession } from './headless-session';
import { HEADLESS_TOOLS } from './headless-tools';
import { HeadlessTransport, canonicalJson, sha256 } from './headless-transport';

import type { ToolRequestPayload } from './headless-main.types';
import type { HeadlessStreamEvent } from './headless-session.types';

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

  const transport = new HeadlessTransport(options.backendUrl);
  const token = await transport.signIn(options.credentials);
  const threadId = await transport.createThread(token, 'Headless run');
  const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };
  const started = await transport.startRun(token, {
    schemaVersion: '2.0',
    threadId,
    clientRequestId: `request.${randomUUID()}`,
    idempotencyKey: `idem.${randomUUID()}`,
    prompt: options.prompt,
    manifestHash: sha256(JSON.stringify({ targets: ['target:workspace'] })),
    toolCatalogHash: sha256(JSON.stringify(HEADLESS_TOOLS)),
    toolDefinitions: HEADLESS_TOOLS,
    provider: options.provider,
    model: options.model,
    epochs,
    budget: {
      maxModelTurns: 20,
      maxToolCalls: 40,
      maxToolRounds: 20,
      maxRepairAttempts: 1,
      maxRuntimeMs: options.deadlineMs,
      maxOutputBytes: 1_048_576,
      maxToolResultBytes: 262_144,
    },
  });

  const run = { ...started, threadId };
  const report = await runHeadlessSession({
    events: () => transport.events(token, run),
    answerTool: async (event) => {
      await transport.submitResult(token, run, epochs, resultFor(event, options.workspace));
    },
    now: () => Date.now(),
    deadlineMs: options.deadlineMs,
  });

  stdout.write(
    options.json
      ? `${JSON.stringify({ ...report, runId: run.runId, workspace: options.workspace })}\n`
      : `${describeHeadlessOutcome(report.outcome)} ${String(report.toolCalls)} tool call(s).\n`,
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
    credentials: { email, password },
  };
}

function flag(name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

/** Runs one requested tool, separating what it produced from why it could not. */
function attemptTool(
  payload: ToolRequestPayload,
  workspace: string,
): { structured?: unknown; failure?: unknown } {
  try {
    return {
      structured: execute(
        payload.toolName ?? '',
        payload.operation ?? '',
        payload.invocation?.arguments ?? {},
        workspace,
      ),
    };
  } catch (error) {
    return {
      failure: {
        code: 'TOOL_FAILED',
        message: (error instanceof Error ? error.message : 'Tool failed').slice(0, 400),
        retryable: false,
        redactionApplied: false,
      },
    };
  }
}

/** Builds the result the backend verifies, including the receipt it hashes. */
function resultFor(event: HeadlessStreamEvent, workspace: string): unknown {
  const payload = (event.payload ?? {}) as ToolRequestPayload;
  const invocationId = payload.invocationId ?? 'invocation.unknown';
  const args = payload.invocation?.arguments ?? {};
  const startedAt = new Date().toISOString();
  const { structured, failure } = attemptTool(payload, workspace);
  const modelText = structured === undefined ? null : JSON.stringify(structured).slice(0, 2_000);
  const canonical = canonicalJson({
    error: failure ?? null,
    modelText,
    structured: structured ?? null,
  });
  return {
    schemaVersion: '2.0',
    invocationId,
    status: failure === undefined ? 'succeeded' : 'failed',
    ...(structured === undefined ? {} : { structured }),
    ...(modelText === null ? {} : { modelText }),
    ...(failure === undefined ? {} : { error: failure }),
    receipt: {
      schemaVersion: '2.0',
      receiptId: `receipt.${randomUUID()}`,
      invocationId,
      argumentHash: sha256(canonicalJson(args)),
      resultHash: sha256(canonical),
      startedAt,
      completedAt: startedAt,
      durationMs: 0,
      outputBytes: Buffer.byteLength(canonical, 'utf8'),
      truncated: false,
      redactionApplied: false,
    },
    continuation: { action: 'continue', nextTurnId: `turn.${randomUUID()}` },
  };
}

function execute(
  toolName: string,
  operation: string,
  args: Record<string, unknown>,
  workspace: string,
): unknown {
  if (toolName === 'workspace.command') return runCommandTool(args, workspace);
  const target = inside(workspace, typeof args.path === 'string' ? args.path : '.');
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
 * Refuses any path that would leave the workspace.
 *
 * The model chooses these paths, and a headless run has nobody to notice that
 * one of them climbed out of the directory it was given.
 */
function inside(workspace: string, relative: string): string {
  const target = path.resolve(workspace, relative);
  if (target !== workspace && !target.startsWith(workspace + path.sep)) {
    throw new Error('Path escapes the workspace');
  }
  return target;
}

/**
 * Runs a bounded command and reports what it produced.
 *
 * The captured streams are read as nullable even though the type declarations
 * promise strings, because a spawn that fails or times out leaves them null and
 * the honest type is the one that matches what arrives.
 */
function runCommandTool(args: Record<string, unknown>, workspace: string): unknown {
  const executable = typeof args.executable === 'string' ? args.executable : '';
  const finished = spawnSync(executable, toStrings(args.arguments), {
    cwd: workspace,
    encoding: 'utf8',
    timeout: 30_000,
    shell: false,
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
