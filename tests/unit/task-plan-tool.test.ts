import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPlanStore } from '../../src/sdk/task-plan-store';
import { createPlanTool } from '../../src/sdk/task-plan-tool';
import { PLAN_MAX_STEPS } from '../../src/sdk/task-plan-tool.constants';
import { resolveToolAlias } from '../../src/sdk/tool-alias';
import { toolCategory, workspaceToolkit } from '../../src/sdk/workspace-toolkit';

import type { PlanStepCheck, PlanSummary } from '../../src/sdk/task-plan-tool.types';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function directory(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

const flagCheck = (file = 'ok.flag'): PlanStepCheck => ({
  executable: 'node',
  args: [
    '-e',
    `if (require("fs").existsSync(${JSON.stringify(file)})) process.exit(0); console.error("missing-flag-xyz"); process.exit(3)`,
  ],
});

function fresh(options: { allowed?: boolean; approve?: () => boolean; state?: string } = {}) {
  const workspace = directory('plan-ws-');
  const store = createPlanStore({
    workspace,
    threadId: () => 't1',
    stateDirectory: options.state,
  });
  const changes: PlanSummary[] = [];
  const tool = createPlanTool(store, {
    workspace,
    onChanged: (summary) => changes.push(summary),
    modelChecks: {
      allowed: options.allowed ?? true,
      executables: ['node', 'npm', 'npx'],
      ...(options.approve === undefined ? {} : { approve: options.approve }),
    },
  });
  return { workspace, store, changes, tool };
}

describe('task.plan set, list, next', () => {
  it('sets steps with default ids, lists them and points at the next one', async () => {
    const { tool, changes } = fresh();

    const set = await tool.execute('set', {
      steps: [{ title: 'Write the parser' }, { id: 'tests', title: 'Write tests' }],
    });

    expect(set).toMatch(/Plan saved: 2 step/u);
    expect(await tool.execute('list', {})).toBe(
      's1 [todo] Write the parser\ntests [todo] Write tests',
    );
    expect(await tool.execute('next', {})).toMatch(/Next: s1 - Write the parser/u);
    expect(changes).toEqual([{ total: 2, todo: 2, doing: 0, done: 0, blocked: 0 }]);
  });

  it('says so when there is no plan', async () => {
    const { tool } = fresh();
    expect(await tool.execute('list', {})).toBe('No plan.');
    expect(await tool.execute('next', {})).toMatch(/No plan yet/u);
  });

  it.each([
    ['no steps', {}],
    ['an empty list', { steps: [] }],
    ['a step that is not an object', { steps: ['do it'] }],
    ['a step with no title', { steps: [{ id: 'a' }] }],
    [
      'a duplicate id',
      {
        steps: [
          { id: 'a', title: 'x' },
          { id: 'a', title: 'y' },
        ],
      },
    ],
    ['an id with a space', { steps: [{ id: 'a b', title: 'x' }] }],
    [
      'too many steps',
      { steps: Array.from({ length: PLAN_MAX_STEPS + 1 }, (_, i) => ({ title: `s${String(i)}` })) },
    ],
    ['a check with no executable', { steps: [{ title: 'x', check: { args: [] } }] }],
    [
      'a check with bad args',
      { steps: [{ title: 'x', check: { executable: 'node', args: [1] } }] },
    ],
    [
      'a check with a bad timeout',
      { steps: [{ title: 'x', check: { executable: 'node', timeoutMs: 0 } }] },
    ],
  ])('refuses %s', async (_name, args) => {
    const { tool, store } = fresh();
    await expect(Promise.resolve().then(() => tool.execute('set', args))).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });

  it('refuses a step or check that holds a secret instead of storing it', async () => {
    const { tool } = fresh();
    await expect(
      Promise.resolve().then(() =>
        tool.execute('set', {
          steps: [
            {
              title: 'x',
              check: { executable: 'node', args: ['--token=sk-abcdefghijklmnopqrstuvwxyz123456'] },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/secret/u);
  });

  it('rejects an unknown operation', async () => {
    const { tool } = fresh();
    await expect(Promise.resolve().then(() => tool.execute('wipe', {}))).rejects.toThrow(
      /Unsupported/u,
    );
  });
});

describe('task.plan update', () => {
  it('moves a step without a check straight to done', async () => {
    const { tool, store, changes } = fresh();
    await tool.execute('set', {
      steps: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    });

    const result = await tool.execute('update', { id: 'a', status: 'done', note: 'did it' });

    expect(result).toMatch(/Step a is done/u);
    expect(result).toMatch(/1\/2 done\. Next: b/u);
    expect(store.list()[0]).toMatchObject({ id: 'a', status: 'done', note: 'did it' });
    expect(changes.at(-1)).toEqual({ total: 2, todo: 1, doing: 0, done: 1, blocked: 0 });
  });

  it('refuses done while the check fails, returns the output tail, and leaves the step as it was', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A', check: flagCheck() }] });
    await tool.execute('update', { id: 'a', status: 'doing' });

    const attempt = await tool.execute('update', { id: 'a', status: 'done' });

    expect(attempt).toMatchObject({
      refused: true,
      step: 'a',
      status: 'doing',
      message: expect.stringMatching(/NOT done.*exit 3/u) as string,
      checkOutputEnd: expect.stringContaining('missing-flag-xyz') as string,
    });
    expect(store.list()[0]?.status).toBe('doing');
  });

  it('claiming done with a note that says the check passed changes nothing', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A', check: flagCheck() }] });

    const attempt = await tool.execute('update', {
      id: 'a',
      status: 'done',
      note: 'check passed, trust me',
    });

    expect(attempt).toMatchObject({ refused: true });

    expect(store.list()[0]).toMatchObject({ status: 'todo' });
    expect(store.list()[0]?.note).toBeUndefined();
  });

  it('runs the check and accepts done once it passes, marking the step verified', async () => {
    const { tool, store, workspace } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A', check: flagCheck() }] });
    writeFileSync(path.join(workspace, 'ok.flag'), 'x');

    const result = await tool.execute('update', { id: 'a', status: 'done' });

    expect(result).toMatch(/Its check passed/u);
    expect(store.list()[0]).toMatchObject({ status: 'done', verified: true });
    expect(await tool.execute('list', {})).toMatch(/\[done, verified\]/u);
  });

  it('re-opening a done step clears its verified mark', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A' }] });
    await tool.execute('update', { id: 'a', status: 'done' });
    await tool.execute('update', { id: 'a', status: 'todo' });
    expect(store.list()[0]).toMatchObject({ status: 'todo' });
    expect(store.list()[0]?.verified).toBeUndefined();
  });

  it('names the known ids for an unknown step, and the allowed statuses for a bad one', async () => {
    const { tool } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A' }] });
    await expect(
      Promise.resolve().then(() => tool.execute('update', { id: 'zzz', status: 'done' })),
    ).rejects.toThrow(/no step "zzz"\. Steps: a/u);
    await expect(
      Promise.resolve().then(() => tool.execute('update', { id: 'a', status: 'finished' })),
    ).rejects.toThrow(/todo, doing, done, blocked/u);
  });

  it('kills a check that hangs at its timeout and refuses the step', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', {
      steps: [
        {
          id: 'a',
          title: 'A',
          check: {
            executable: 'node',
            args: ['-e', 'setInterval(() => {}, 1000)'],
            timeoutMs: 300,
          },
        },
      ],
    });
    expect(await tool.execute('update', { id: 'a', status: 'done' })).toMatchObject({
      refused: true,
      checkOutputEnd: expect.stringContaining('Timed out') as string,
    });
    expect(store.list()[0]?.status).toBe('todo');
  });

  it('keeps a check inside the workspace: a cwd that escapes is a failed check', async () => {
    const { tool } = fresh();
    await tool.execute('set', {
      steps: [{ id: 'a', title: 'A', check: { ...flagCheck(), cwd: '../..' } }],
    });
    expect(await tool.execute('update', { id: 'a', status: 'done' })).toMatchObject({
      refused: true,
    });
  });

  it('stops a check when the run is cancelled', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', {
      steps: [
        {
          id: 'a',
          title: 'A',
          check: { executable: 'node', args: ['-e', 'setInterval(() => {}, 1000)'] },
        },
      ],
    });
    const controller = new AbortController();
    const attempt = Promise.resolve().then(() =>
      tool.execute('update', { id: 'a', status: 'done' }, controller.signal),
    );
    setTimeout(() => {
      controller.abort();
    }, 150);
    expect(await attempt).toMatchObject({
      refused: true,
      checkOutputEnd: expect.stringContaining('Cancelled') as string,
    });
    expect(store.list()[0]?.status).toBe('todo');
  });

  it('never leaks a secret the check printed', async () => {
    const { tool } = fresh();
    await tool.execute('set', {
      steps: [
        {
          id: 'a',
          title: 'A',
          check: {
            executable: 'node',
            args: [
              '-e',
              'console.error("token sk-" + "abcdefghijklmnopqrstuvwxyz123456"); process.exit(1)',
            ],
          },
        },
      ],
    });
    const attempt = await tool.execute('update', { id: 'a', status: 'done' });
    expect(attempt).toMatchObject({ refused: true });
    expect(JSON.stringify(attempt)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
  });

  it('two concurrent updates each keep their own result: a passing one is not lost to a failing one', async () => {
    const { tool, store, workspace } = fresh();
    await tool.execute('set', {
      steps: [
        { id: 'a', title: 'A', check: flagCheck('a.flag') },
        { id: 'b', title: 'B', check: flagCheck('b.flag') },
      ],
    });
    writeFileSync(path.join(workspace, 'a.flag'), '');
    const [first, second] = await Promise.allSettled([
      Promise.resolve().then(() => tool.execute('update', { id: 'a', status: 'done' })),
      Promise.resolve().then(() => tool.execute('update', { id: 'b', status: 'done' })),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'fulfilled', value: { refused: true } });
    expect(store.list().map((step) => step.status)).toEqual(['done', 'todo']);
  });

  it('two concurrent passing updates are both kept', async () => {
    const { tool, store, workspace } = fresh();
    await tool.execute('set', {
      steps: [
        { id: 'a', title: 'A', check: flagCheck('a.flag') },
        { id: 'b', title: 'B', check: flagCheck('b.flag') },
      ],
    });
    writeFileSync(path.join(workspace, 'a.flag'), '');
    writeFileSync(path.join(workspace, 'b.flag'), '');
    await Promise.all([
      Promise.resolve().then(() => tool.execute('update', { id: 'a', status: 'done' })),
      Promise.resolve().then(() => tool.execute('update', { id: 'b', status: 'done' })),
    ]);
    expect(store.list().map((step) => step.status)).toEqual(['done', 'done']);
  });
});

describe('model-written checks are held to the command grant', () => {
  it('refuses a check when the run has no command grant', async () => {
    const { tool, store } = fresh({ allowed: false });
    await expect(
      Promise.resolve().then(() =>
        tool.execute('set', { steps: [{ title: 'x', check: flagCheck() }] }),
      ),
    ).rejects.toThrow(/no command grant/u);
    expect(store.list()).toEqual([]);
    await tool.execute('set', { steps: [{ title: 'x' }] });
  });

  it('refuses an executable that is not on the allowlist, and one given as a path', async () => {
    const { tool } = fresh();
    for (const executable of ['curl', '../node', '/bin/sh']) {
      await expect(
        Promise.resolve().then(() =>
          tool.execute('set', { steps: [{ title: 'x', check: { executable } }] }),
        ),
      ).rejects.toThrow(/not an allowed command/u);
    }
  });

  it('asks the approval callback before a model-written check runs, and keeps the step open when refused', async () => {
    const asked: string[] = [];
    const { tool, store } = fresh({
      approve: () => {
        asked.push('asked');
        return false;
      },
    });
    await tool.execute('set', { steps: [{ id: 'a', title: 'A', check: flagCheck() }] });
    await expect(
      Promise.resolve().then(() => tool.execute('update', { id: 'a', status: 'done' })),
    ).rejects.toThrow(/not approved/u);
    expect(asked).toEqual(['asked']);
    expect(store.list()[0]?.status).toBe('todo');
  });
});

describe('re-planning', () => {
  it('keeps done steps and drops nothing the model already proved', async () => {
    const { tool, store } = fresh();
    await tool.execute('set', {
      steps: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    });
    await tool.execute('update', { id: 'a', status: 'done' });

    const result = await tool.execute('set', { steps: [{ id: 'c', title: 'C' }] });

    expect(result).toMatch(/1 done or imposed step\(s\) were kept/u);
    expect(store.list().map((step) => `${step.id}:${step.status}`)).toEqual(['a:done', 'c:todo']);
  });

  it('cannot redefine a done step by planning it again without its check', async () => {
    const { tool, store, workspace } = fresh();
    await tool.execute('set', { steps: [{ id: 'a', title: 'A', check: flagCheck() }] });
    writeFileSync(path.join(workspace, 'ok.flag'), '');
    await tool.execute('update', { id: 'a', status: 'done' });
    await tool.execute('set', { steps: [{ id: 'a', title: 'A again' }] });
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ title: 'A', verified: true });
  });
});

describe('the plan store', () => {
  it('writes under the state directory, never into the workspace, and a new store reads it back', async () => {
    const state = directory('plan-state-');
    const first = fresh({ state });
    await first.tool.execute('set', { steps: [{ id: 'a', title: 'A' }] });

    expect(readdirSync(path.join(state, 'plan'))).toHaveLength(1);
    expect(readdirSync(first.workspace)).toEqual([]);

    const again = createPlanStore({
      workspace: first.workspace,
      threadId: () => 't1',
      stateDirectory: state,
    });
    expect(again.list().map((step) => step.id)).toEqual(['a']);
    const other = createPlanStore({
      workspace: first.workspace,
      threadId: () => 't2',
      stateDirectory: state,
    });
    expect(other.list()).toEqual([]);
  });

  it('moves a plan made before the thread existed to the thread once it does', () => {
    const state = directory('plan-state-');
    const workspace = directory('plan-ws-');
    const holder: { thread?: string } = {};
    const store = createPlanStore({
      workspace,
      threadId: () => holder.thread,
      stateDirectory: state,
    });
    store.save([{ id: 'a', title: 'A', status: 'todo' }]);
    holder.thread = 'thread-9';
    expect(store.list().map((step) => step.id)).toEqual(['a']);
    const reopened = createPlanStore({
      workspace,
      threadId: () => 'thread-9',
      stateDirectory: state,
    });
    expect(reopened.list().map((step) => step.id)).toEqual(['a']);
  });

  it('treats a corrupt file as no plan and refuses a plan over the size cap', () => {
    const state = directory('plan-state-');
    const workspace = directory('plan-ws-');
    const store = createPlanStore({ workspace, threadId: () => 't1', stateDirectory: state });
    store.save([{ id: 'a', title: 'A', status: 'todo' }]);
    const file = path.join(state, 'plan', readdirSync(path.join(state, 'plan'))[0] ?? '');
    writeFileSync(file, '{not json');
    const reopened = createPlanStore({ workspace, threadId: () => 't1', stateDirectory: state });
    expect(reopened.list()).toEqual([]);
    const huge = Array.from({ length: 30 }, (_, index) => ({
      id: `s${String(index)}`,
      title: 'x'.repeat(3_000),
      status: 'todo' as const,
    }));
    expect(() => {
      reopened.save(huge);
    }).toThrow(/too big/u);
  });

  it('keeps the state out of a workspace that contains the state directory', () => {
    const workspace = directory('plan-ws-');
    const store = createPlanStore({
      workspace,
      threadId: () => 't1',
      stateDirectory: path.join(workspace, '.state'),
    });
    store.save([{ id: 'a', title: 'A', status: 'todo' }]);
    expect(existsSync(path.join(workspace, '.state'))).toBe(false);
  });
});

describe('task.plan in the toolkit', () => {
  it('is category read, so it needs no grant, and is offered with all four operations', () => {
    for (const operation of ['set', 'update', 'list', 'next']) {
      expect(toolCategory({ toolName: 'task.plan', operation, arguments: {} })).toBe('read');
    }
    const toolkit = workspaceToolkit(directory('plan-ws-'), { allow: ['read'] });
    const offered = toolkit.definitions.find(
      (entry) => (entry as { name: string }).name === 'task.plan',
    );
    expect(offered).toMatchObject({ operations: ['set', 'update', 'list', 'next'] });
  });

  it('runs through the executor, and a model check is refused without the command grant', async () => {
    const toolkit = workspaceToolkit(directory('plan-ws-'), { allow: ['read'] });
    const set = await toolkit.execute({
      toolName: 'task.plan',
      operation: 'set',
      arguments: { steps: [{ id: 'a', title: 'A' }] },
    });
    expect(JSON.stringify(set)).toMatch(/Plan saved/u);
    await expect(
      Promise.resolve().then(() =>
        toolkit.execute({
          toolName: 'task.plan',
          operation: 'set',
          arguments: { steps: [{ id: 'b', title: 'B', check: { executable: 'node', args: [] } }] },
        }),
      ),
    ).rejects.toThrow(/no command grant/u);
  });

  it('is available in plan mode too: it changes only the agent state', async () => {
    const toolkit = workspaceToolkit(directory('plan-ws-'), {
      allow: ['read'],
      offerRefused: true,
    });
    expect(
      await toolkit.authorize?.({ toolName: 'task.plan', operation: 'update', arguments: {} }),
    ).toBe(true);
  });
});

describe('near-miss names for the plan tool', () => {
  const call = (toolName: string, operation: string) => ({ toolName, operation, arguments: {} });

  it.each([
    ['task.plan.update', '', 'update'],
    ['task_plan', 'list', 'list'],
    ['Task.Plan.Next', 'next', 'next'],
    ['task.plan.set', 'set', 'set'],
  ])('reads %s as task.plan %s', (name, operation, expected) => {
    expect(resolveToolAlias(call(name, operation))).toMatchObject({
      toolName: 'task.plan',
      operation: expected,
    });
  });

  it('leaves an ambiguous or unknown one alone', () => {
    expect(resolveToolAlias(call('task.plan.update', 'set')).toolName).toBe('task.plan.update');
    expect(resolveToolAlias(call('task.plan.wipe', '')).toolName).toBe('task.plan.wipe');
    expect(resolveToolAlias(call('task.planner', 'list')).toolName).toBe('task.planner');
  });
});
