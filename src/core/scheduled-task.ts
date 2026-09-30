import {
  DEFAULT_MAX_RUNS,
  MAX_INTERVAL_MINUTES,
  MAX_ONCE_DELAY_MINUTES,
  MAX_RUNS_LIMIT,
  MAX_SCHEDULED_LABEL_LENGTH,
  MAX_SCHEDULED_PROMPT_LENGTH,
  MAX_SCHEDULED_TASKS,
  MAX_TIMER_MS,
  MIN_INTERVAL_MINUTES,
  MS_PER_MINUTE,
} from './scheduled-task.constants';
import { scheduledTaskListSchema } from './scheduled-task.schema';
import { nextCronTime, planCron } from './scheduled-task-cron';

import type {
  SchedulePlan,
  ScheduleRequest,
  ScheduledTask,
  TaskSchedule,
} from './scheduled-task.types';

function refuse(refusal: string): SchedulePlan {
  return { planned: false, refusal };
}

function inRange(value: number | undefined, min: number, max: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max;
}

function planOnce(
  request: ScheduleRequest,
  common: Omit<ScheduledTask, 'schedule' | 'nextRunAt' | 'maxRuns'>,
  now: number,
): SchedulePlan {
  if (!inRange(request.inMinutes, 1, MAX_ONCE_DELAY_MINUTES)) {
    return refuse(`inMinutes must be a whole number from 1 to ${String(MAX_ONCE_DELAY_MINUTES)}.`);
  }
  return {
    planned: true,
    task: {
      ...common,
      schedule: { kind: 'once' },
      nextRunAt: now + request.inMinutes * MS_PER_MINUTE,
      maxRuns: 1,
    },
  };
}

function planInterval(
  request: ScheduleRequest,
  common: Omit<ScheduledTask, 'schedule' | 'nextRunAt' | 'maxRuns'>,
  now: number,
): SchedulePlan {
  if (!inRange(request.everyMinutes, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)) {
    return refuse(
      `everyMinutes must be a whole number from ${String(MIN_INTERVAL_MINUTES)} to ${String(MAX_INTERVAL_MINUTES)}.`,
    );
  }
  const maxRuns = request.maxRuns ?? DEFAULT_MAX_RUNS;
  if (!inRange(maxRuns, 1, MAX_RUNS_LIMIT)) {
    return refuse(`maxRuns must be a whole number from 1 to ${String(MAX_RUNS_LIMIT)}.`);
  }
  return {
    planned: true,
    task: {
      ...common,
      schedule: { kind: 'interval', everyMinutes: request.everyMinutes },
      nextRunAt: now + request.everyMinutes * MS_PER_MINUTE,
      maxRuns,
    },
  };
}

/**
 * Turns a request into a task, or says why it cannot be one.
 *
 * Every bound is checked here rather than trusted from the caller, because the
 * caller is a model. A refusal is a normal result: "too frequent" is something
 * to read and adjust, not something that should end a run.
 */
export function planScheduledTask(
  request: ScheduleRequest,
  existingCount: number,
  now: number,
  id: string,
): SchedulePlan {
  const prompt = request.prompt.trim();
  if (prompt.length === 0) return refuse('A scheduled task needs a prompt.');
  if (prompt.length > MAX_SCHEDULED_PROMPT_LENGTH) return refuse('The prompt is too long.');
  if (existingCount >= MAX_SCHEDULED_TASKS) {
    return refuse(
      `At most ${String(MAX_SCHEDULED_TASKS)} tasks may be scheduled. Delete one first.`,
    );
  }
  const requested = request.label?.trim() ?? '';
  const common = {
    id,
    label: (requested.length > 0 ? requested : prompt).slice(0, MAX_SCHEDULED_LABEL_LENGTH),
    prompt,
    createdAt: now,
    runs: 0,
  };
  if (request.kind === 'once') return planOnce(request, common, now);
  if (request.kind === 'cron') return planCron(request, common, now);
  return planInterval(request, common, now);
}

/**
 * The task as it stands after one run, or undefined when it has no more to do.
 * A repeating task is rescheduled from `now`, not from its old time, so a
 * machine that slept through three intervals runs once rather than three times.
 */
export function afterRun(task: ScheduledTask, now: number): ScheduledTask | undefined {
  const runs = task.runs + 1;
  if (task.schedule.kind === 'once' || runs >= task.maxRuns) return undefined;
  const nextRunAt = nextRunFrom(task.schedule, now);
  return nextRunAt === undefined ? undefined : { ...task, runs, nextRunAt };
}

/** The next run of a repeating schedule, counted from `now`; undefined when there is none. */
function nextRunFrom(schedule: TaskSchedule, now: number): number | undefined {
  if (schedule.kind === 'once') return undefined;
  if (schedule.kind === 'cron') return nextCronTime(schedule.expression, now);
  return now + schedule.everyMinutes * MS_PER_MINUTE;
}

export function dueTasks(tasks: readonly ScheduledTask[], now: number): readonly ScheduledTask[] {
  return tasks.filter((task) => task.nextRunAt <= now);
}

/** How long to sleep before looking again: to the next task, never past a day. */
export function nextDelay(tasks: readonly ScheduledTask[], now: number): number | undefined {
  if (tasks.length === 0) return undefined;
  const soonest = Math.min(...tasks.map((task) => task.nextRunAt));
  return Math.min(Math.max(soonest - now, 0), MAX_TIMER_MS);
}

/**
 * What survives a restart. A one-off whose time passed while the editor was
 * closed is dropped instead of firing late: running a prompt nobody expected
 * hours after it was meant is worse than not running it. A repeating task
 * resumes from now, without catching up on what it missed.
 */
export function restoreTasks(stored: unknown, now: number): readonly ScheduledTask[] {
  const parsed = scheduledTaskListSchema.safeParse(stored);
  if (!parsed.success) return [];
  const restored: ScheduledTask[] = [];
  for (const task of parsed.data) {
    if (task.nextRunAt > now) restored.push(task);
    else {
      const nextRunAt = nextRunFrom(task.schedule, now);
      if (nextRunAt !== undefined) restored.push({ ...task, nextRunAt });
    }
  }
  return restored;
}
