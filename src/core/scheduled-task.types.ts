export type TaskSchedule =
  | { readonly kind: 'once' }
  | { readonly kind: 'interval'; readonly everyMinutes: number }
  | { readonly kind: 'cron'; readonly expression: string };

export interface ScheduledTask {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly schedule: TaskSchedule;
  /** Epoch milliseconds of the next run. */
  readonly nextRunAt: number;
  readonly createdAt: number;
  readonly runs: number;
  readonly maxRuns: number;
}

export interface ScheduleRequest {
  readonly prompt: string;
  readonly label?: string | undefined;
  readonly kind: 'once' | 'interval' | 'cron';
  /** For `once`: minutes from now. */
  readonly inMinutes?: number | undefined;
  /** For `interval`: minutes between runs. */
  readonly everyMinutes?: number | undefined;
  /** For `cron`: minute hour day-of-month month day-of-week, in this machine's local time. */
  readonly cron?: string | undefined;
  readonly maxRuns?: number | undefined;
}

export type SchedulePlan =
  | { readonly planned: true; readonly task: ScheduledTask }
  | { readonly planned: false; readonly refusal: string };
