import {
  CRON_FIELD_COUNT,
  CRON_MAX_LENGTH,
  CRON_RANGES,
  CRON_SEARCH_LIMIT,
} from './cron-expression.constants';

import type { CronFieldRange, CronFields, CronParse } from './cron-expression.types';

const WHOLE_NUMBER = /^\d{1,2}$/u;

function whole(text: string): number | undefined {
  return WHOLE_NUMBER.test(text) ? Number(text) : undefined;
}

/** The low and high end a part names, or undefined when malformed. */
function bounds(
  base: string,
  hasStep: boolean,
  range: CronFieldRange,
): readonly [number, number] | undefined {
  if (base === '*') return [range.min, range.max];
  const [from = '', to, ...more] = base.split('-');
  if (more.length > 0) return undefined;
  const low = whole(from);
  if (low === undefined) return undefined;
  // "5/10" means "from 5 to the end, every 10"; a bare "5" means just 5.
  const high = to === undefined ? (hasStep ? range.max : low) : whole(to);
  if (high === undefined || low < range.min || high > range.max || low > high) return undefined;
  return [low, high];
}

/** The values one comma-separated part of a field allows, or undefined when malformed. */
function partValues(part: string, range: CronFieldRange): number[] | undefined {
  const [base = '', stepText, ...extra] = part.split('/');
  if (extra.length > 0) return undefined;
  const step = stepText === undefined ? 1 : whole(stepText);
  if (step === undefined || step < 1) return undefined;
  const span = bounds(base, stepText !== undefined, range);
  if (span === undefined) return undefined;
  const values: number[] = [];
  for (let value = span[0]; value <= span[1]; value += step) values.push(value);
  return values;
}

function fieldValues(text: string, range: CronFieldRange): ReadonlySet<number> | undefined {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const found = partValues(part, range);
    if (found === undefined) return undefined;
    for (const value of found) values.add(value);
  }
  return values;
}

/**
 * Reads a five-field cron expression: minute hour day-of-month month day-of-week.
 *
 * Numbers, lists, ranges, `*` and steps are understood. Month and weekday
 * names, `L`, `W`, `#` and `@daily` are not: a refusal the model can read and
 * correct is better than a guess.
 */
export function parseCron(expression: string): CronParse {
  const text = expression.trim();
  if (text.length === 0 || text.length > CRON_MAX_LENGTH) {
    return { parsed: false, reason: 'The cron expression is empty or too long.' };
  }
  const parts = text.split(/\s+/u);
  if (parts.length !== CRON_FIELD_COUNT) {
    return {
      parsed: false,
      reason: 'A cron expression has five fields: minute hour day-of-month month day-of-week.',
    };
  }
  const sets = parts.map((part, index) => {
    const range = CRON_RANGES[index];
    return range === undefined ? undefined : fieldValues(part, range);
  });
  const [minutes, hours, daysOfMonth, months, weekdays] = sets;
  if (
    minutes === undefined ||
    hours === undefined ||
    daysOfMonth === undefined ||
    months === undefined ||
    weekdays === undefined
  ) {
    const bad = sets.findIndex((set) => set === undefined);
    return { parsed: false, reason: `The ${CRON_RANGES[bad]?.name ?? 'cron'} field is not valid.` };
  }
  return {
    parsed: true,
    fields: {
      minutes,
      hours,
      daysOfMonth,
      months,
      daysOfWeek: new Set([...weekdays].map((day) => day % 7)),
      anyDayOfMonth: parts[2] === '*',
      anyDayOfWeek: parts[4] === '*',
    },
  };
}

/** Standard cron: when both day fields are restricted, either one matching is enough. */
function dayMatches(fields: CronFields, date: Date): boolean {
  const monthDay = fields.daysOfMonth.has(date.getDate());
  const weekDay = fields.daysOfWeek.has(date.getDay());
  if (fields.anyDayOfMonth) return weekDay;
  if (fields.anyDayOfWeek) return monthDay;
  return monthDay || weekDay;
}

/**
 * The first matching minute strictly after `afterMs`, in this machine's local
 * time, or undefined when none exists within the search limit (31 February).
 * Steps to the next month, day or hour whenever a coarser field cannot match,
 * so a yearly expression costs a few hundred steps, not half a million.
 */
export function nextCronRun(fields: CronFields, afterMs: number): number | undefined {
  const date = new Date(afterMs);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  for (let step = 0; step < CRON_SEARCH_LIMIT; step += 1) {
    if (!fields.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
    } else if (!dayMatches(fields, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
    } else if (!fields.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
    } else if (!fields.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
    } else {
      return date.getTime();
    }
  }
  return undefined;
}
