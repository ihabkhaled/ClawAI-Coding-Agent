import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { BUDGET_FAILED, COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentConfig, AgentEvent } from '../../src/sdk/create-agent.types';
import type { DoneCheck } from '../../src/sdk/done-checks.types';

const created: string[] = [];
let workspace = '';
const saved = process.env.CLAW_STATE_DIR;

beforeEach(() => {
  const state = mkdtempSync(path.join(tmpdir(), 'claw-state-'));
  workspace = mkdtempSync(path.join(tmpdir(), 'claw-dc-run-'));
  created.push(state, workspace);
  process.env.CLAW_STATE_DIR = state;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const node = (label: string, code: string, extra: Partial<DoneCheck> = {}): DoneCheck => ({
  label,
  executable: process.execPath,
  args: ['-e', code],
  ...extra,
});

/** Passes once `ok.flag` exists in the workspace, and says what is missing until then. */
const needsFlag = (label = 'tests'): DoneCheck =>
  node(
    label,
    'if (require("fs").existsSync("ok.flag")) process.exit(0); console.error("missing-flag-xyz"); process.exit(3)',
  );

const FAILS = (label: string, code = 1): DoneCheck => node(label, `process.exit(${String(code)})`);

const noteCall = (text: string): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: `n-${text}`,
    toolName: 'workspace.notes',
    operation: 'add',
    invocation: { arguments: { text } },
  },
});

async function run(
  scripts: Parameters<typeof scriptedRuns>[0],
  config: Partial<AgentConfig>,
  options: { autoContinue?: number; onEvent?: (event: AgentEvent) => void } = {},
) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 't' },
    workspaceRoot: workspace,
    transport: runtime.transport,
    ...config,
  });
  const result = await agent.run('build it', {
    autoContinue: options.autoContinue,
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
  });
  return { runtime, events, result };
}

const countOf = (events: readonly AgentEvent[], type: AgentEvent['type']): number =>
  events.filter((event) => event.type === type).length;

describe('completion checks in the SDK', () => {
  it('changes nothing when no check is configured', async () => {
    const { runtime, events, result } = await run([[COMPLETED]], {});

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('completed');
    expect(result.checks).toBeUndefined();
    expect(result.errorCode).toBeUndefined();
    expect(countOf(events, 'run.checks')).toBe(0);
  });

  it('treats an empty list as no checks', async () => {
    const { events, result } = await run([[COMPLETED]], { doneChecks: [] });

    expect(result.checks).toBeUndefined();
    expect(countOf(events, 'run.checks')).toBe(0);
  });

  it('emits run.checks and finishes normally when every check passes', async () => {
    const { runtime, events, result } = await run([[COMPLETED]], {
      doneChecks: [node('a', ''), node('b', '')],
    });

    expect(runtime.starts).toHaveLength(1);
    expect(result).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      checks: [
        { label: 'a', ok: true, exitCode: 0 },
        { label: 'b', ok: true, exitCode: 0 },
      ],
    });
    expect(result.continuations).toBe(0);
    const checks = events.find((event) => event.type === 'run.checks');
    expect(checks).toMatchObject({ passed: true });
    expect(JSON.stringify(checks)).toContain('durationMs');
    expect(events.at(-1)?.type).toBe('run.finished');
    expect(countOf(events, 'run.finished')).toBe(1);
  });

  it('continues when a check fails, with the label, output tail and notes, then passes', async () => {
    const { runtime, events, result } = await run(
      [[noteCall('remember the schema'), COMPLETED], [COMPLETED]],
      { doneChecks: [needsFlag()] },
      {
        autoContinue: 2,
        onEvent: (event) => {
          if (event.type === 'run.continued') writeFileSync(path.join(workspace, 'ok.flag'), '');
        },
      },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]?.threadId).toBe(runtime.starts[0]?.threadId);
    const prompt = runtime.starts[1]?.prompt ?? '';
    expect(prompt).toContain("the orchestrator's completion checks failed");
    expect(prompt).toContain('Do NOT declare done until every check passes.');
    expect(prompt).toContain('tests: exit 3;');
    expect(prompt).toContain('missing-flag-xyz');
    expect(prompt).toContain('Your notes so far:\n1. remember the schema');
    expect(result).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      continuations: 1,
      checks: [{ label: 'tests', ok: true, exitCode: 0 }],
    });
    expect(events).toContainEqual({ type: 'run.continued', attempt: 1, reason: 'checks-failed' });
    const reports = events.flatMap((event) => (event.type === 'run.checks' ? [event.passed] : []));
    expect(reports).toEqual([false, true]);
    expect(countOf(events, 'run.finished')).toBe(1);
    expect(events.at(-1)?.type).toBe('run.finished');
  });

  it('fails with DONE_CHECKS_FAILED when the continuations are used up', async () => {
    const { runtime, events, result } = await run(
      [[COMPLETED], [COMPLETED]],
      { doneChecks: [FAILS('gate', 9)] },
      { autoContinue: 1 },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(result).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      errorCode: 'DONE_CHECKS_FAILED',
      continuations: 1,
      checks: [{ label: 'gate', ok: false, exitCode: 9 }],
    });
    expect(result.error?.startsWith('DONE_CHECKS_FAILED')).toBe(true);
    expect(result.error).toContain('gate');
    expect(countOf(events, 'run.checks')).toBe(2);
    expect(countOf(events, 'run.finished')).toBe(1);
  });

  it('fails at once when autoContinue is 0 and a check fails', async () => {
    const { runtime, result } = await run([[COMPLETED]], { doneChecks: [FAILS('gate')] });

    expect(runtime.starts).toHaveLength(1);
    expect(result).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      errorCode: 'DONE_CHECKS_FAILED',
      continuations: 0,
    });
  });

  it('puts every failing check in the prompt and only those', async () => {
    const { runtime } = await run(
      [[COMPLETED], [COMPLETED]],
      { doneChecks: [FAILS('alpha', 2), node('fine', ''), FAILS('gamma', 4)] },
      { autoContinue: 1 },
    );

    const prompt = runtime.starts[1]?.prompt ?? '';
    expect(prompt).toContain('alpha: exit 2;');
    expect(prompt).toContain('gamma: exit 4;');
    expect(prompt).not.toContain('fine');
  });

  it('runs the checks even in plan mode, and outside the write scope', async () => {
    const { result } = await run([[COMPLETED]], {
      permissionMode: 'plan',
      permissions: { allow: ['read', 'write'], writeScope: ['src/**'] },
      doneChecks: [
        node('writes', 'require("fs").writeFileSync("made-by-check.txt", "x")'),
        node('sees-it', 'process.exit(require("fs").existsSync("made-by-check.txt") ? 0 : 1)'),
      ],
    });

    expect(existsSync(path.join(workspace, 'made-by-check.txt'))).toBe(true);
    expect(result.outcome).toBe('completed');
    expect(result.checks?.every((check) => check.ok)).toBe(true);
  });

  it('redacts secrets in the continuation prompt', async () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const { runtime, result } = await run(
      [[COMPLETED], [COMPLETED]],
      {
        doneChecks: [
          node('leaky', `console.error("Authorization: Bearer ${secret}"); process.exit(1)`),
        ],
      },
      { autoContinue: 1 },
    );

    expect(runtime.starts[1]?.prompt).not.toContain(secret);
    expect(runtime.starts[1]?.prompt).toContain('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each([
    ['a failed run', [{ type: 'run.failed', payload: { code: 'X', message: 'boom' } }] as const],
    ['a blocked run', [{ type: 'run.blocked' }] as const],
    ['a cancelled run', [{ type: 'run.cancelled' }] as const],
  ])('does not run checks after %s', async (_name, script) => {
    const { runtime, events, result } = await run(
      [[...script]],
      { doneChecks: [node('marker', 'require("fs").writeFileSync("ran.txt", "x")')] },
      { autoContinue: 2 },
    );

    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).not.toBe('completed');
    expect(result.checks).toBeUndefined();
    expect(countOf(events, 'run.checks')).toBe(0);
    expect(existsSync(path.join(workspace, 'ran.txt'))).toBe(false);
  });

  it('leaves the budget continuation alone, and checks only the run that completes', async () => {
    const { runtime, events, result } = await run(
      [[BUDGET_FAILED], [COMPLETED]],
      { doneChecks: [node('ok', '')] },
      { autoContinue: 2 },
    );

    expect(runtime.starts).toHaveLength(2);
    expect(events).toContainEqual({
      type: 'run.continued',
      attempt: 1,
      reason: 'budget-exhausted',
    });
    expect(countOf(events, 'run.checks')).toBe(1);
    expect(result).toMatchObject({ outcome: 'completed', continuations: 1 });
  });

  it('still ends as exhausted, not as a check failure, when the budget runs out', async () => {
    const { result } = await run(
      [[BUDGET_FAILED]],
      { doneChecks: [FAILS('gate')] },
      { autoContinue: 0 },
    );

    expect(result).toMatchObject({ outcome: 'exhausted', exitCode: 5 });
    expect(result.errorCode).toBeUndefined();
    expect(result.checks).toBeUndefined();
  });

  it('reports a cancel that arrives while the checks run as cancelled', async () => {
    const controller = new AbortController();
    const runtime = scriptedRuns([[COMPLETED]]);
    const agent = createAgent({
      auth: { token: 't' },
      workspaceRoot: workspace,
      transport: runtime.transport,
      doneChecks: [node('slow', 'setTimeout(() => {}, 30000)', { timeoutMs: 30_000 })],
    });

    const result = await agent.run('go', {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'run.started') {
          setTimeout(() => {
            controller.abort();
          }, 1500);
        }
      },
    });

    expect(result.outcome).toBe('cancelled');
    expect(result.exitCode).toBe(130);
  }, 20_000);

  it('rejects unusable checks when the agent is created', () => {
    const make = (doneChecks: DoneCheck[]) => () =>
      createAgent({ auth: { token: 't' }, workspaceRoot: workspace, doneChecks });

    expect(make([node('a', ''), node('a', '')])).toThrow(RangeError);
    expect(make([node('', '')])).toThrow(RangeError);
    expect(make([node('a', '', { timeoutMs: 3_600_001 })])).toThrow(RangeError);
  });
});
