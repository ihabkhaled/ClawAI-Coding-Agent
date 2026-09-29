import { describe, expect, it } from 'vitest';

import { planScheduledTask } from '../../src/core/scheduled-task';
import { nodeTimers, WorkspaceScheduleStore } from '../../src/infrastructure/schedule-store';
import {
  ScheduleToolExecutor,
  scheduleToolDefinition,
} from '../../src/infrastructure/schedule-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { ScheduledTask } from '../../src/core/scheduled-task.types';
import type { SchedulePort } from '../../src/infrastructure/schedule-tool-executor.types';

function call(operation: string, args: Record<string, unknown>): ToolInvocation {
  return { toolName: scheduleToolDefinition.name, operation, arguments: args } as ToolInvocation;
}

function fakePort(): SchedulePort {
  const tasks: ScheduledTask[] = [];
  return {
    create: (request) => {
      const plan = planScheduledTask(request, tasks.length, 0, `t${String(tasks.length)}`);
      if (plan.planned) tasks.push(plan.task);
      return Promise.resolve(plan);
    },
    list: () => tasks,
    remove: (id) => {
      const index = tasks.findIndex((task) => task.id === id);
      if (index >= 0) tasks.splice(index, 1);
      return Promise.resolve(index >= 0);
    },
  };
}

describe('ScheduleToolExecutor', () => {
  it('creates, lists and deletes', async () => {
    const executor = new ScheduleToolExecutor(fakePort());
    const created = await executor.execute(
      call('create', { prompt: 'check build', kind: 'once', inMinutes: 5 }),
    );
    expect(created.structured).toMatchObject({ created: true, id: 't0', maxRuns: 1 });
    const listed = await executor.execute(call('list', {}));
    expect(JSON.stringify(listed.structured)).toContain('check build');
    const deleted = await executor.execute(call('delete', { id: 't0' }));
    expect(deleted.structured).toEqual({ deleted: true });
  });

  it('returns a refusal as a normal result', async () => {
    const executor = new ScheduleToolExecutor(fakePort());
    const result = await executor.execute(
      call('create', { prompt: 'x', kind: 'interval', everyMinutes: 1 }),
    );
    expect(result.structured).toMatchObject({ created: false });
  });

  it('rejects malformed arguments and unknown operations', async () => {
    const executor = new ScheduleToolExecutor(fakePort());
    await expect(executor.execute(call('create', { kind: 'once' }))).rejects.toThrow();
    await expect(executor.execute(call('nope', {}))).rejects.toThrow('Unknown schedule operation');
  });
});

describe('WorkspaceScheduleStore', () => {
  it('reads and writes under the state key', async () => {
    const data = new Map<string, unknown>();
    const store = new WorkspaceScheduleStore({
      get: (key) => data.get(key),
      update: (key, value) => {
        data.set(key, value);
        return Promise.resolve();
      },
    });
    expect(store.read()).toBeUndefined();
    await store.write([]);
    expect(store.read()).toEqual([]);
  });
});

describe('nodeTimers', () => {
  it('fires once and can be cleared', async () => {
    let fired = 0;
    const handle = nodeTimers.set(() => {
      fired += 1;
    }, 1);
    nodeTimers.clear(handle);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fired).toBe(0);
    nodeTimers.set(() => {
      fired += 1;
    }, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fired).toBe(1);
  });
});
