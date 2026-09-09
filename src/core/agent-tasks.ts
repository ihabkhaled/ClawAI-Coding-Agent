import { z } from 'zod';

export const AGENT_TASK_STATUSES = ['pending', 'in-progress', 'blocked', 'done'] as const;

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

/**
 * A task the agent is working through, distinct from an implementation plan.
 *
 * `implementation-plan.ts` already models work, but as a delivery artifact:
 * epics, capabilities, stories, and tasks that each require at least one
 * acceptance criterion and one verification step. That is the right shape for a
 * plan someone reviews and the wrong shape for "what am I doing right now",
 * where the cost of writing it down has to be near zero or it does not get
 * written. These are run state, they are replaced freely, and nothing is
 * promised about them.
 */
export const agentTaskSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    status: z.enum(AGENT_TASK_STATUSES),
    /** Why it is blocked, or what was decided. Absent when there is nothing to add. */
    note: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export type AgentTask = z.infer<typeof agentTaskSchema>;

export const agentTaskListSchema = z
  .array(agentTaskSchema)
  .max(100)
  .superRefine((tasks, context) => {
    const ids = tasks.map((task) => task.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Task ids must be unique.' });
    }
    // A list where three things are in progress is a list of intentions, not a
    // record of work. Holding the invariant here means a reader can always
    // answer "what is happening now" with one line.
    if (tasks.filter((task) => task.status === 'in-progress').length > 1) {
      context.addIssue({
        code: 'custom',
        message: 'Only one task may be in progress at a time.',
      });
    }
  });

export interface TaskProgress {
  readonly tasks: readonly AgentTask[];
  readonly total: number;
  readonly done: number;
  readonly blocked: number;
  /** The single task in progress, when there is one. */
  readonly current: AgentTask | undefined;
}

/**
 * Reports the list in the order it was given.
 *
 * Deliberately not sorted by status: the order the agent wrote is the order it
 * intends to work, and re-ordering by state would move a task the moment it
 * started, which is exactly when a reader is looking at it.
 */
export function summarizeTasks(tasks: readonly AgentTask[]): TaskProgress {
  return {
    tasks,
    total: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
    blocked: tasks.filter((task) => task.status === 'blocked').length,
    current: tasks.find((task) => task.status === 'in-progress'),
  };
}
