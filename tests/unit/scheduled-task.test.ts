import { describe, expect, it } from 'vitest';

import {
  afterRun,
  dueTasks,
  nextDelay,
  planScheduledTask,
  restoreTasks,
} from '../../src/core/scheduled-task';
import {
  MAX_SCHEDULED_TASKS,
  MAX_TIMER_MS,
  MS_PER_MINUTE,
} from '../../src/core/scheduled-task.constants';

import type { ScheduledTask } from '../../src/core/scheduled-task.types';

const NOW = 1_000_000;

function planned(request: Parameters<typeof planScheduledTask>[0]): ScheduledTask {
  const plan = planScheduledTask(request, 0, NOW, 'abc');
  if (!plan.planned) throw new Error(plan.refusal);
  return plan.task;
}

describe('planScheduledTask', () => {
  it('plans a one-off at now plus the delay', () => {
    const task = planned({ prompt: 'run tests', kind: 'once', inMinutes: 10 });
    expect(task.nextRunAt).toBe(NOW + 10 * MS_PER_MINUTE);
    expect(task.maxRuns).toBe(1);
  });

  it('refuses an interval below the minimum', () => {
    const plan = planScheduledTask({ prompt: 'x', kind: 'interval', everyMinutes: 1 }, 0, NOW, 'a');
    expect(plan.planned).toBe(false);
  });

  it('defaults and bounds maxRuns', () => {
    expect(planned({ prompt: 'x', kind: 'interval', everyMinutes: 5 }).maxRuns).toBe(10);
    const plan = planScheduledTask(
      { prompt: 'x', kind: 'interval', everyMinutes: 5, maxRuns: 101 },
      0,
      NOW,
      'a',
    );
    expect(plan.planned).toBe(false);
  });

  it('refuses an empty prompt and too many tasks', () => {
    expect(
      planScheduledTask({ prompt: '  ', kind: 'once', inMinutes: 1 }, 0, NOW, 'a').planned,
    ).toBe(false);
    expect(
      planScheduledTask({ prompt: 'x', kind: 'once', inMinutes: 1 }, MAX_SCHEDULED_TASKS, NOW, 'a')
        .planned,
    ).toBe(false);
  });

  it('refuses a non-integer delay', () => {
    expect(
      planScheduledTask({ prompt: 'x', kind: 'once', inMinutes: 1.5 }, 0, NOW, 'a').planned,
    ).toBe(false);
  });
});

describe('afterRun', () => {
  it('drops a one-off', () => {
    expect(afterRun(planned({ prompt: 'x', kind: 'once', inMinutes: 1 }), NOW)).toBeUndefined();
  });

  it('reschedules an interval from now and ends it at maxRuns', () => {
    const task = planned({ prompt: 'x', kind: 'interval', everyMinutes: 5, maxRuns: 2 });
    const next = afterRun(task, NOW + 99);
    expect(next?.runs).toBe(1);
    expect(next?.nextRunAt).toBe(NOW + 99 + 5 * MS_PER_MINUTE);
    expect(next === undefined ? undefined : afterRun(next, NOW)).toBeUndefined();
  });
});

describe('dueTasks and nextDelay', () => {
  it('finds due tasks and caps the delay at a day', () => {
    const soon = planned({ prompt: 'a', kind: 'once', inMinutes: 1 });
    const late = { ...soon, id: 'b', nextRunAt: NOW + 10 * MAX_TIMER_MS };
    expect(dueTasks([soon, late], NOW + MS_PER_MINUTE)).toEqual([soon]);
    expect(nextDelay([late], NOW)).toBe(MAX_TIMER_MS);
    expect(nextDelay([], NOW)).toBeUndefined();
  });
});

describe('restoreTasks', () => {
  it('drops a missed one-off, resumes an interval from now, and ignores junk', () => {
    const once = { ...planned({ prompt: 'a', kind: 'once', inMinutes: 1 }), nextRunAt: 5 };
    const every = {
      ...planned({ prompt: 'b', kind: 'interval', everyMinutes: 5 }),
      id: 'i',
      nextRunAt: 5,
    };
    const restored = restoreTasks([once, every], NOW);
    expect(restored.map((task) => task.id)).toEqual(['i']);
    expect(restored[0]?.nextRunAt).toBe(NOW + 5 * MS_PER_MINUTE);
    expect(restoreTasks('nonsense', NOW)).toEqual([]);
    expect(restoreTasks(undefined, NOW)).toEqual([]);
  });
});

describe('cron tasks', () => {
  const at = (hour: number, minute: number): number =>
    new Date(2026, 2, 10, hour, minute, 0, 0).getTime();

  it('plans a cron task at its first match and bounds maxRuns', () => {
    const now = at(9, 0);
    const plan = planScheduledTask({ prompt: 'x', kind: 'cron', cron: '30  9 * * *' }, 0, now, 'c');
    expect(plan.planned && plan.task.nextRunAt).toBe(at(9, 30));
    expect(plan.planned && plan.task.schedule).toEqual({ kind: 'cron', expression: '30 9 * * *' });
    expect(plan.planned && plan.task.maxRuns).toBe(10);
    const tooMany = planScheduledTask(
      { prompt: 'x', kind: 'cron', cron: '0 9 * * *', maxRuns: 101 },
      0,
      now,
      'c',
    );
    expect(tooMany.planned).toBe(false);
  });

  it('refuses a bad, never-matching or too frequent expression', () => {
    const plan = (cron: string | undefined): ReturnType<typeof planScheduledTask> =>
      planScheduledTask({ prompt: 'x', kind: 'cron', cron }, 0, at(9, 0), 'c');
    expect(plan('nonsense')).toMatchObject({ planned: false });
    expect(plan(undefined)).toMatchObject({ planned: false });
    expect(plan('0 0 31 2 *')).toMatchObject({
      planned: false,
      refusal: expect.stringContaining('never'),
    });
    expect(plan('* * * * *')).toMatchObject({
      planned: false,
      refusal: expect.stringContaining('5 minutes'),
    });
    expect(plan('0,2 9 * * *')).toMatchObject({ planned: false });
    expect(plan('*/5 * * * *')).toMatchObject({ planned: true });
  });

  it('reschedules from now after a run and ends at maxRuns', () => {
    const task = planned({ prompt: 'x', kind: 'cron', cron: '0 * * * *', maxRuns: 2 });
    const next = afterRun(task, at(9, 59));
    expect(next?.runs).toBe(1);
    expect(next?.nextRunAt).toBe(at(10, 0));
    expect(next === undefined ? undefined : afterRun(next, at(10, 0))).toBeUndefined();
  });

  it('ends a task whose stored expression no longer parses', () => {
    const task = planned({ prompt: 'x', kind: 'cron', cron: '0 * * * *' });
    const broken = { ...task, schedule: { kind: 'cron' as const, expression: 'not a cron' } };
    expect(afterRun(broken, NOW)).toBeUndefined();
    expect(restoreTasks([{ ...broken, nextRunAt: 5 }], NOW)).toEqual([]);
  });

  it('resumes a missed cron task at its next match, not late', () => {
    const task = { ...planned({ prompt: 'x', kind: 'cron', cron: '0 * * * *' }), nextRunAt: 5 };
    const restored = restoreTasks([task], at(9, 30));
    expect(restored[0]?.nextRunAt).toBe(at(10, 0));
  });
});
