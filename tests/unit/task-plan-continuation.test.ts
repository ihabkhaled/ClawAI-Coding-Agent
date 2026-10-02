import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { BUDGET_FAILED, COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentConfig, AgentEvent } from '../../src/sdk/create-agent.types';

const created: string[] = [];
let workspace = '';
const saved = process.env.CLAW_STATE_DIR;

beforeEach(() => {
  const state = mkdtempSync(path.join(tmpdir(), 'claw-state-'));
  workspace = mkdtempSync(path.join(tmpdir(), 'claw-plan-'));
  created.push(state, workspace);
  process.env.CLAW_STATE_DIR = state;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

let counter = 0;
const planCall = (operation: string, args: Record<string, unknown>): HeadlessStreamEvent => {
  counter += 1;
  return {
    type: 'tool.requested',
    payload: {
      invocationId: `p-${String(counter)}`,
      toolName: 'task.plan',
      operation,
      invocation: { arguments: args },
    },
  };
};

const flagCheck = {
  executable: 'node',
  args: [
    '-e',
    'if (require("fs").existsSync("ok.flag")) process.exit(0); console.error("missing-flag-xyz"); process.exit(3)',
  ],
};

async function run(
  scripts: Parameters<typeof scriptedRuns>[0],
  config: Partial<AgentConfig> = {},
  autoContinue: number | undefined = 3,
  onEvent?: (event: AgentEvent) => void,
) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 't' },
    workspaceRoot: workspace,
    transport: runtime.transport,
    permissions: { allow: ['read', 'git', 'command'] },
    taskPlan: true,
    ...config,
  });
  const result = await agent.run('build the library', {
    autoContinue,
    onEvent: (event) => {
      events.push(event);
      onEvent?.(event);
    },
  });
  return { runtime, events, result };
}

const reasons = (events: readonly AgentEvent[]): string[] =>
  events.flatMap((event) => (event.type === 'run.continued' ? [event.reason] : []));

describe('the plan gates completion', () => {
  it('continues a run that says done with open steps, listing them, until the plan is finished', async () => {
    const { runtime, events, result } = await run([
      [
        planCall('set', {
          steps: [
            { id: 'a', title: 'Parser' },
            { id: 'b', title: 'Tests' },
          ],
        }),
        planCall('update', { id: 'a', status: 'done' }),
        COMPLETED,
      ],
      [planCall('update', { id: 'b', status: 'done' }), COMPLETED],
    ]);

    expect(result.outcome).toBe('completed');
    expect(result.continuations).toBe(1);
    expect(reasons(events)).toEqual(['plan-incomplete']);
    const prompt = runtime.starts[1]?.prompt ?? '';
    expect(prompt).toMatch(/still has 1 open step\(s\) of 2/u);
    expect(prompt).toContain('Your plan so far:');
    expect(prompt).toContain('b [todo] Tests');
    expect(prompt.match(/Your plan so far:/gu)).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run.plan')).toEqual([
      { type: 'run.plan', total: 2, todo: 2, doing: 0, done: 0, blocked: 0 },
      { type: 'run.plan', total: 2, todo: 1, doing: 0, done: 1, blocked: 0 },
      { type: 'run.plan', total: 2, todo: 0, doing: 0, done: 2, blocked: 0 },
    ]);
  });

  it('fails with PLAN_INCOMPLETE (exit 1) when the continuations run out with a step open', async () => {
    const { events, result, runtime } = await run(
      [
        [
          planCall('set', {
            steps: [
              { id: 'a', title: 'A' },
              { id: 'b', title: 'B' },
            ],
          }),
          COMPLETED,
        ],
        [COMPLETED],
        [COMPLETED],
      ],
      {},
      2,
    );

    expect(runtime.starts).toHaveLength(3);
    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
    expect(result.error).toMatch(
      /^PLAN_INCOMPLETE: .*2 of 2 plan step\(s\) are not done after 3 run\(s\)/u,
    );
    expect(reasons(events)).toEqual(['plan-incomplete', 'plan-incomplete']);
    expect(events.at(-1)).toMatchObject({
      type: 'run.finished',
      result: { errorCode: 'PLAN_INCOMPLETE' },
    });
  });

  it('fails at once with --auto-continue 0 when a step is open', async () => {
    const { result, runtime } = await run(
      [[planCall('set', { steps: [{ id: 'a', title: 'A' }] }), COMPLETED]],
      {},
      0,
    );
    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
  });

  it('leaves a run alone when it has no plan and none is required', async () => {
    const { result, runtime, events } = await run([[COMPLETED]], {}, 0);
    expect(runtime.starts).toHaveLength(1);
    expect(result.outcome).toBe('completed');
    expect(result.continuations).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: 'run.finished' });
  });

  it('does not gate a run that ended any other way than completed', async () => {
    const { result } = await run(
      [
        [
          planCall('set', { steps: [{ id: 'a', title: 'A' }] }),
          { type: 'run.failed', payload: { code: 'X', message: 'boom' } },
        ],
      ],
      {},
      0,
    );
    expect(result.errorCode).toBeUndefined();
  });

  it('keeps a blocked step open: blocked is not done', async () => {
    const { result } = await run(
      [
        [
          planCall('set', { steps: [{ id: 'a', title: 'A' }] }),
          planCall('update', { id: 'a', status: 'blocked', note: 'needs a key' }),
          COMPLETED,
        ],
      ],
      {},
      0,
    );
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
  });

  it('puts the plan, with its statuses, in a budget continuation prompt too', async () => {
    const { runtime, result } = await run([
      [planCall('set', { steps: [{ id: 'a', title: 'A' }] }), BUDGET_FAILED],
      [planCall('update', { id: 'a', status: 'done' }), COMPLETED],
    ]);
    expect(result.outcome).toBe('completed');
    expect(runtime.starts[1]?.prompt).toContain('Your plan so far:\na [todo] A');
  });
});

describe('a step with a check cannot be declared done', () => {
  it('refuses the claim, the run cannot finish, and the step closes once the check passes', async () => {
    const { result, runtime } = await run(
      [
        [
          planCall('set', { steps: [{ id: 'tests', title: 'Tests pass', check: flagCheck }] }),
          planCall('update', { id: 'tests', status: 'done', note: 'all green, trust me' }),
          COMPLETED,
        ],
        [planCall('update', { id: 'tests', status: 'done' }), COMPLETED],
      ],
      {},
      3,
      (event) => {
        if (event.type === 'run.continued') writeFileSync(path.join(workspace, 'ok.flag'), 'x');
      },
    );

    const sent = JSON.stringify(runtime.submitted);
    expect(sent).toContain('refused');
    expect(sent).toContain('missing-flag-xyz');
    expect(runtime.starts[1]?.prompt).toContain('tests [todo] Tests pass (check: node -e');
    expect(result.outcome).toBe('completed');
    expect(result.continuations).toBe(1);
    expect(runtime.starts[1]?.prompt).not.toContain('trust me');
  });

  it('fails PLAN_INCOMPLETE when the check never passes, however often the model claims done', async () => {
    const claim = [planCall('update', { id: 'tests', status: 'done' }), COMPLETED] as const;
    const { result, runtime } = await run(
      [
        [planCall('set', { steps: [{ id: 'tests', title: 'T', check: flagCheck }] }), ...claim],
        [...claim],
        [...claim],
      ],
      {},
      2,
    );
    expect(result.outcome).toBe('failed');
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
    expect(JSON.stringify(runtime.submitted).split('refused').length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe('--require-plan', () => {
  it('continues a run that made no plan, then passes once a finished plan exists', async () => {
    const { runtime, result, events } = await run(
      [
        [COMPLETED],
        [
          planCall('set', { steps: [{ id: 'a', title: 'A' }] }),
          planCall('update', { id: 'a', status: 'done' }),
          COMPLETED,
        ],
      ],
      { requirePlan: true },
    );
    expect(reasons(events)).toEqual(['plan-incomplete']);
    expect(runtime.starts[1]?.prompt).toMatch(/requires a plan, and you made none/u);
    expect(result.outcome).toBe('completed');
  });

  it('fails PLAN_INCOMPLETE when the run never makes a plan', async () => {
    const { result } = await run([[COMPLETED], [COMPLETED]], { requirePlan: true }, 1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toMatch(/requires a plan and none was made/u);
  });

  it('fails at once with --auto-continue 0', async () => {
    const { result, runtime } = await run([[COMPLETED]], { requirePlan: true }, 0);
    expect(runtime.starts).toHaveLength(1);
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
  });
});

describe('a plan preloaded by the orchestrator', () => {
  const steps = [
    { id: 'lib', title: 'Write the library' },
    { id: 'tests', title: 'Tests pass', check: flagCheck },
  ];

  it('is in the first prompt, announced as run.plan, and cannot be dropped by planning again', async () => {
    writeFileSync(path.join(workspace, 'ok.flag'), 'x');
    const { runtime, events, result } = await run(
      [
        [
          planCall('set', { steps: [{ id: 'mine', title: 'My own step' }] }),
          planCall('update', { id: 'lib', status: 'done' }),
          planCall('update', { id: 'tests', status: 'done' }),
          planCall('update', { id: 'mine', status: 'done' }),
          COMPLETED,
        ],
      ],
      { planSteps: steps, requirePlan: true },
      0,
    );

    expect(runtime.starts[0]?.prompt).toContain(
      'build the library\n\nYour plan so far:\nlib [todo] Write the library',
    );
    expect(events.find((event) => event.type === 'run.plan')).toEqual({
      type: 'run.plan',
      total: 2,
      todo: 2,
      doing: 0,
      done: 0,
      blocked: 0,
    });
    expect(result.outcome).toBe('completed');
    const last = events.filter((event) => event.type === 'run.plan').at(-1);
    expect(last).toMatchObject({ total: 3, done: 3 });
  });

  it('a locked step with a check still needs its check, even though the orchestrator wrote it with a non-allowlisted tool', async () => {
    const { result } = await run(
      [
        [
          planCall('update', { id: 'lib', status: 'done' }),
          planCall('update', { id: 'tests', status: 'done' }),
          COMPLETED,
        ],
      ],
      { planSteps: steps },
      0,
    );
    expect(result.errorCode).toBe('PLAN_INCOMPLETE');
  });

  it('refuses bad steps before any run starts', () => {
    expect(() =>
      createAgent({
        auth: { token: 't' },
        workspaceRoot: workspace,
        planSteps: [{ id: 'a', title: '' }],
      }),
    ).toThrow(/title/u);
  });

  it('keeps the plan across runs of one agent, and a fresh agent starts blank', async () => {
    const first = scriptedRuns([
      [planCall('set', { steps: [{ id: 'a', title: 'A' }] }), COMPLETED],
      [COMPLETED],
    ]);
    const agent = createAgent({
      auth: { token: 't' },
      workspaceRoot: workspace,
      transport: first.transport,
      taskPlan: true,
    });
    const one = await agent.run('go', { autoContinue: 0 });
    expect(one.errorCode).toBe('PLAN_INCOMPLETE');
    const two = await agent.run('again', { autoContinue: 0 });
    expect(two.errorCode).toBe('PLAN_INCOMPLETE');

    const blank = scriptedRuns([[COMPLETED]]);
    const other = mkdtempSync(path.join(tmpdir(), 'claw-plan-'));
    created.push(other);
    const fresh = createAgent({
      auth: { token: 't' },
      workspaceRoot: other,
      transport: blank.transport,
    });
    expect((await fresh.run('go', { autoContinue: 0 })).outcome).toBe('completed');
  });
});
