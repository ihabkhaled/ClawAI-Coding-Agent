import { z } from 'zod';

import { CRON_MAX_LENGTH } from '../core/cron-expression.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import {
  MAX_INTERVAL_MINUTES,
  MAX_ONCE_DELAY_MINUTES,
  MAX_RUNS_LIMIT,
  MAX_SCHEDULED_LABEL_LENGTH,
  MAX_SCHEDULED_PROMPT_LENGTH,
  MAX_SCHEDULED_TASKS,
  MIN_INTERVAL_MINUTES,
} from '../core/scheduled-task.constants';

import type { SchedulePort } from './schedule-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const createSchema = z.object({
  prompt: z.string().trim().min(1).max(MAX_SCHEDULED_PROMPT_LENGTH),
  label: z.string().trim().max(MAX_SCHEDULED_LABEL_LENGTH).optional(),
  kind: z.enum(['once', 'interval', 'cron']),
  inMinutes: z.number().int().optional(),
  everyMinutes: z.number().int().optional(),
  cron: z.string().trim().max(CRON_MAX_LENGTH).optional(),
  maxRuns: z.number().int().optional(),
});

const deleteSchema = z.object({ id: z.string().trim().min(1).max(64) });

export const scheduleToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.schedule',
  version: '2.0.0',
  description:
    'Schedule a prompt to start a new agent run later. create takes prompt, kind "once" with ' +
    `inMinutes (1 to ${String(MAX_ONCE_DELAY_MINUTES)}), or kind "interval" with everyMinutes ` +
    `(${String(MIN_INTERVAL_MINUTES)} to ${String(MAX_INTERVAL_MINUTES)}) and optional maxRuns ` +
    '(a repeating task stops by itself after maxRuns), or kind "cron" with cron, five fields ' +
    '(minute hour day-of-month month day-of-week, local time; numbers, lists, ranges, * and steps, ' +
    `no names) that may not fire more often than every ${String(MIN_INTERVAL_MINUTES)} minutes, plus optional maxRuns ` +
    `(up to ${String(MAX_RUNS_LIMIT)}); a repeating task stops by itself after maxRuns. At most ` +
    `${String(MAX_SCHEDULED_TASKS)} tasks may exist. Tasks run only while the editor is open, and a ` +
    'one-off missed while it was closed is dropped. list shows what is scheduled; delete takes an id. ' +
    'The scheduled run uses the normal permission mode and asks for approval like any other run.',
  operations: ['create', 'list', 'delete'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.schedule,
};

/**
 * Creating, listing and deleting scheduled runs.
 *
 * Refusals (too frequent, too many, bad number) are ordinary results, not
 * errors: the model should read them and adjust rather than lose the run.
 */
export class ScheduleToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly schedule: SchedulePort) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== scheduleToolDefinition.name) {
      throw new Error('Unknown schedule tool');
    }
    if (invocation.operation === 'create') return this.create(invocation.arguments);
    if (invocation.operation === 'list') return Promise.resolve(this.list());
    if (invocation.operation === 'delete') return this.remove(invocation.arguments);
    throw new Error('Unknown schedule operation');
  }

  private async create(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const request = createSchema.parse(args);
    const plan = await this.schedule.create(request);
    if (!plan.planned) return { structured: { created: false, refusal: plan.refusal } };
    return {
      structured: {
        created: true,
        id: plan.task.id,
        nextRunAt: new Date(plan.task.nextRunAt).toISOString(),
        maxRuns: plan.task.maxRuns,
      },
    };
  }

  private list(): RuntimeToolExecutionOutput {
    return {
      structured: {
        tasks: this.schedule.list().map((task) => ({
          id: task.id,
          label: task.label,
          kind: task.schedule.kind,
          nextRunAt: new Date(task.nextRunAt).toISOString(),
          runs: task.runs,
          maxRuns: task.maxRuns,
        })),
      },
    };
  }

  private async remove(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { id } = deleteSchema.parse(args);
    return { structured: { deleted: await this.schedule.remove(id) } };
  }
}
