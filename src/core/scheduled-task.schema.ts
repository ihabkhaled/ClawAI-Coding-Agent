import { z } from 'zod';

import {
  MAX_INTERVAL_MINUTES,
  MAX_RUNS_LIMIT,
  MAX_SCHEDULED_LABEL_LENGTH,
  MAX_SCHEDULED_PROMPT_LENGTH,
  MAX_SCHEDULED_TASKS,
} from './scheduled-task.constants';

/**
 * A persisted task, parsed rather than trusted: workspace state is written by
 * this extension, but an older version or a hand edit can leave anything there.
 */
export const scheduledTaskSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(MAX_SCHEDULED_LABEL_LENGTH),
    prompt: z.string().min(1).max(MAX_SCHEDULED_PROMPT_LENGTH),
    schedule: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('once') }).strict(),
      z
        .object({
          kind: z.literal('interval'),
          everyMinutes: z.number().int().min(1).max(MAX_INTERVAL_MINUTES),
        })
        .strict(),
    ]),
    nextRunAt: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative().max(MAX_RUNS_LIMIT),
    maxRuns: z.number().int().min(1).max(MAX_RUNS_LIMIT),
  })
  .strict();

export const scheduledTaskListSchema = z.array(scheduledTaskSchema).max(MAX_SCHEDULED_TASKS);
