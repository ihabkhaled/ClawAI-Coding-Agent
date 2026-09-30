import { describe, expect, it } from 'vitest';

import { nextCronRun, parseCron } from '../../src/core/cron-expression';

import type { CronFields } from '../../src/core/cron-expression.types';

function fieldsOf(expression: string): CronFields {
  const parsed = parseCron(expression);
  if (!parsed.parsed) throw new Error(parsed.reason);
  return parsed.fields;
}

/** Local-time date, so the tests hold in any time zone. */
function local(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('parseCron', () => {
  it('reads lists, ranges, steps and stars', () => {
    const fields = fieldsOf('0,30 9-11 */10 1-3 1-5');
    expect([...fields.minutes]).toEqual([0, 30]);
    expect([...fields.hours]).toEqual([9, 10, 11]);
    expect([...fields.daysOfMonth]).toEqual([1, 11, 21, 31]);
    expect([...fields.months]).toEqual([1, 2, 3]);
    expect([...fields.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it('treats 7 as Sunday and a step from a start as running to the end', () => {
    expect([...fieldsOf('0 0 * * 7').daysOfWeek]).toEqual([0]);
    expect([...fieldsOf('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
  });

  it.each([
    ['', 'empty'],
    ['* * * *', 'four fields'],
    ['* * * * * *', 'six fields'],
    ['60 * * * *', 'minute out of range'],
    ['* 24 * * *', 'hour out of range'],
    ['* * 0 * *', 'day zero'],
    ['* * * 13 *', 'month 13'],
    ['* * * * 8', 'weekday 8'],
    ['5-1 * * * *', 'backwards range'],
    ['*/0 * * * *', 'zero step'],
    ['a * * * *', 'letters'],
    ['@daily', 'alias'],
    ['* * * JAN *', 'names'],
    ['1/2/3 * * * *', 'two steps'],
    ['1-2-3 * * * *', 'two dashes'],
  ])('refuses %j (%s)', (expression) => {
    expect(parseCron(expression).parsed).toBe(false);
  });

  it('refuses an expression that is too long', () => {
    expect(parseCron(`${'1,'.repeat(60)}1 * * * *`).parsed).toBe(false);
  });

  it('names the field that is wrong', () => {
    const parsed = parseCron('0 99 * * *');
    expect(parsed).toEqual({ parsed: false, reason: 'The hour field is not valid.' });
  });
});

describe('nextCronRun', () => {
  it('finds the next matching minute strictly after the given time', () => {
    const fields = fieldsOf('30 9 * * *');
    expect(nextCronRun(fields, local(2026, 3, 10, 9, 29))).toBe(local(2026, 3, 10, 9, 30));
    expect(nextCronRun(fields, local(2026, 3, 10, 9, 30))).toBe(local(2026, 3, 11, 9, 30));
  });

  it('ignores seconds inside the current minute', () => {
    const inside = new Date(2026, 2, 10, 9, 29, 45, 500).getTime();
    expect(nextCronRun(fieldsOf('30 9 * * *'), inside)).toBe(local(2026, 3, 10, 9, 30));
  });

  it('respects the weekday: 2026-03-09 is a Monday', () => {
    const fields = fieldsOf('0 8 * * 1');
    expect(nextCronRun(fields, local(2026, 3, 9, 8, 0))).toBe(local(2026, 3, 16, 8, 0));
  });

  it('matches either day field when both are restricted', () => {
    const fields = fieldsOf('0 0 15 * 1');
    // From the 10th: Monday the 16th is not until later, but the 15th is a match by day of month.
    expect(nextCronRun(fields, local(2026, 3, 10, 12, 0))).toBe(local(2026, 3, 15, 0, 0));
    expect(nextCronRun(fields, local(2026, 3, 15, 0, 0))).toBe(local(2026, 3, 16, 0, 0));
  });

  it('jumps months and years', () => {
    expect(nextCronRun(fieldsOf('0 0 1 1 *'), local(2026, 3, 10))).toBe(local(2027, 1, 1));
    expect(nextCronRun(fieldsOf('0 0 29 2 *'), local(2026, 3, 10))).toBe(local(2028, 2, 29));
  });

  it('steps through a range of minutes', () => {
    const fields = fieldsOf('*/15 * * * *');
    expect(nextCronRun(fields, local(2026, 3, 10, 9, 1))).toBe(local(2026, 3, 10, 9, 15));
    expect(nextCronRun(fields, local(2026, 3, 10, 9, 45))).toBe(local(2026, 3, 10, 10, 0));
  });

  it('gives up on a date that never exists', () => {
    expect(nextCronRun(fieldsOf('0 0 31 2 *'), local(2026, 3, 10))).toBeUndefined();
  });
});
