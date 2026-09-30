import type { CronFieldRange } from './cron-expression.types';

export const CRON_FIELD_COUNT = 5;
export const CRON_MAX_LENGTH = 100;
/** Hard stop for the search, so an impossible date such as 31 February ends. */
export const CRON_SEARCH_LIMIT = 200_000;

export const CRON_MINUTE: CronFieldRange = { name: 'minute', min: 0, max: 59 };
export const CRON_HOUR: CronFieldRange = { name: 'hour', min: 0, max: 23 };
export const CRON_DAY_OF_MONTH: CronFieldRange = { name: 'day of month', min: 1, max: 31 };
export const CRON_MONTH: CronFieldRange = { name: 'month', min: 1, max: 12 };
/** 0 and 7 both mean Sunday. */
export const CRON_DAY_OF_WEEK: CronFieldRange = { name: 'day of week', min: 0, max: 7 };

export const CRON_RANGES: readonly CronFieldRange[] = [
  CRON_MINUTE,
  CRON_HOUR,
  CRON_DAY_OF_MONTH,
  CRON_MONTH,
  CRON_DAY_OF_WEEK,
];
