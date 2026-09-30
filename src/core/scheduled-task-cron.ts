import { nextCronRun, parseCron } from './cron-expression';
import {
  CRON_MIN_GAP_CHECKS,
  DEFAULT_MAX_RUNS,
  MAX_RUNS_LIMIT,
  MIN_INTERVAL_MINUTES,
  MS_PER_MINUTE,
} from './scheduled-task.constants';

import type { CronFields } from './cron-expression.types';
import type { SchedulePlan, ScheduleRequest, ScheduledTask } from './scheduled-task.types';

type CommonTask = Omit<ScheduledTask, 'schedule' | 'nextRunAt' | 'maxRuns'>;

/** Whether any of the next few gaps is shorter than a repeating task may run. */
function tooFrequent(fields: CronFields, first: number): boolean {
  let previous = first;
  for (let index = 0; index < CRON_MIN_GAP_CHECKS; index += 1) {
    const next = nextCronRun(fields, previous);
    if (next === undefined) return false;
    if (next - previous < MIN_INTERVAL_MINUTES * MS_PER_MINUTE) return true;
    previous = next;
  }
  return false;
}

/** The next run of a stored cron task, or undefined when its expression no longer parses or has no date. */
export function nextCronTime(expression: string, after: number): number | undefined {
  const parsed = parseCron(expression);
  return parsed.parsed ? nextCronRun(parsed.fields, after) : undefined;
}

/**
 * A cron-scheduled task, or a readable refusal. The same floor as an interval
 * applies: an expression that would fire more often than every five minutes is
 * a polling loop, whatever notation it is written in.
 */
export function planCron(request: ScheduleRequest, common: CommonTask, now: number): SchedulePlan {
  const expression = (request.cron ?? '').trim().replace(/\s+/gu, ' ');
  const parsed = parseCron(expression);
  if (!parsed.parsed) return { planned: false, refusal: parsed.reason };
  const first = nextCronRun(parsed.fields, now);
  if (first === undefined) {
    return { planned: false, refusal: 'That cron expression never matches a real date.' };
  }
  if (tooFrequent(parsed.fields, first)) {
    return {
      planned: false,
      refusal: `A cron schedule may fire at most every ${String(MIN_INTERVAL_MINUTES)} minutes.`,
    };
  }
  const maxRuns = request.maxRuns ?? DEFAULT_MAX_RUNS;
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS_LIMIT) {
    return {
      planned: false,
      refusal: `maxRuns must be a whole number from 1 to ${String(MAX_RUNS_LIMIT)}.`,
    };
  }
  return {
    planned: true,
    task: { ...common, schedule: { kind: 'cron', expression }, nextRunAt: first, maxRuns },
  };
}
