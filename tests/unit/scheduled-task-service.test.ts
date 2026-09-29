import { describe, expect, it } from 'vitest';

import { MS_PER_MINUTE } from '../../src/core/scheduled-task.constants';
import { ScheduledTaskService } from '../../src/services/scheduled-task-service';

import type { ScheduledTask } from '../../src/core/scheduled-task.types';

class FakeTimers {
  pending: { callback: () => void; delay: number } | undefined;
  set(callback: () => void, delay: number): unknown {
    const entry = {
      callback: () => {
        if (this.pending === entry) this.pending = undefined;
        callback();
      },
      delay,
    };
    this.pending = entry;
    return entry;
  }
  clear(): void {
    this.pending = undefined;
  }
}

function setup(initial?: unknown) {
  const clock = { now: 1_000_000 };
  const timers = new FakeTimers();
  const written: (readonly ScheduledTask[])[] = [];
  const errors: unknown[] = [];
  let counter = 0;
  const service = new ScheduledTaskService(
    {
      read: () => initial,
      write: (tasks) => {
        written.push(tasks);
        return Promise.resolve();
      },
    },
    timers,
    () => clock.now,
    () => `id${String((counter += 1))}`,
    (_task, error) => errors.push(error),
  );
  return { clock, timers, written, errors, service };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ScheduledTaskService', () => {
  it('arms one timer at the soonest task and runs it when it fires', async () => {
    const { clock, timers, service, written } = setup();
    const ran: string[] = [];
    await service.start((task) => {
      ran.push(task.prompt);
      return Promise.resolve();
    });
    expect(timers.pending).toBeUndefined();
    await service.create({ prompt: 'later', kind: 'once', inMinutes: 30 });
    await service.create({ prompt: 'soon', kind: 'once', inMinutes: 5 });
    expect(timers.pending?.delay).toBe(5 * MS_PER_MINUTE);
    clock.now += 5 * MS_PER_MINUTE;
    timers.pending?.callback();
    await flush();
    expect(ran).toEqual(['soon']);
    expect(service.list().map((task) => task.prompt)).toEqual(['later']);
    expect(written.at(-1)?.length).toBe(1);
    expect(timers.pending?.delay).toBe(25 * MS_PER_MINUTE);
  });

  it('stops a repeating task at maxRuns', async () => {
    const { clock, timers, service } = setup();
    let runs = 0;
    await service.start(() => {
      runs += 1;
      return Promise.resolve();
    });
    await service.create({ prompt: 'p', kind: 'interval', everyMinutes: 5, maxRuns: 2 });
    for (let i = 0; i < 3; i += 1) {
      clock.now += 5 * MS_PER_MINUTE;
      timers.pending?.callback();
      await flush();
    }
    expect(runs).toBe(2);
    expect(service.list()).toEqual([]);
    expect(timers.pending).toBeUndefined();
  });

  it('removes a task and clears the timer', async () => {
    const { timers, service } = setup();
    await service.start(() => Promise.resolve());
    const plan = await service.create({ prompt: 'p', kind: 'once', inMinutes: 5 });
    const id = plan.planned ? plan.task.id : '';
    expect(await service.remove('missing')).toBe(false);
    expect(await service.remove(id)).toBe(true);
    expect(timers.pending).toBeUndefined();
  });

  it('reports a failing runner and keeps going', async () => {
    const { clock, timers, service, errors } = setup();
    await service.start(() => Promise.reject(new Error('boom')));
    await service.create({ prompt: 'p', kind: 'once', inMinutes: 1 });
    clock.now += MS_PER_MINUTE;
    timers.pending?.callback();
    await flush();
    expect(errors).toHaveLength(1);
  });

  it('dispose clears the timer and nothing re-arms afterwards', async () => {
    const { timers, service } = setup();
    await service.start(() => Promise.resolve());
    await service.create({ prompt: 'p', kind: 'once', inMinutes: 5 });
    service.dispose();
    expect(timers.pending).toBeUndefined();
    await service.create({ prompt: 'q', kind: 'once', inMinutes: 5 });
    expect(timers.pending).toBeUndefined();
  });

  it('restores a saved schedule on start', async () => {
    const seed = setup();
    await seed.service.start(() => Promise.resolve());
    await seed.service.create({ prompt: 'keep', kind: 'interval', everyMinutes: 10 });
    const restored = setup(seed.service.list());
    await restored.service.start(() => Promise.resolve());
    expect(restored.service.list().map((task) => task.prompt)).toEqual(['keep']);
    expect(restored.timers.pending).toBeDefined();
  });

  it('refuses a bad request without touching the store', async () => {
    const { service, written } = setup();
    await service.start(() => Promise.resolve());
    const before = written.length;
    const plan = await service.create({ prompt: 'x', kind: 'interval', everyMinutes: 1 });
    expect(plan.planned).toBe(false);
    expect(written.length).toBe(before);
  });
});
