import type { PlanStepStatus } from './task-plan-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

/** The most steps one plan holds. */
export const PLAN_MAX_STEPS = 30;

/** The longest step id, title and note. */
export const PLAN_MAX_ID_CHARS = 32;
export const PLAN_MAX_TITLE_CHARS = 200;
export const PLAN_MAX_NOTE_CHARS = 500;

/** The most bytes of plan one conversation keeps. */
export const PLAN_MAX_BYTES = 64 * 1024;

/** The characters of a failing check's output handed back to the model. */
export const PLAN_CHECK_TAIL_CHARS = 1_500;

/** The most characters a plan takes in a prompt or a `list` result. */
export const PLAN_PROMPT_MAX_CHARS = 6_000;

/** Where the plan lives under the state directory. */
export const PLAN_DIRECTORY_NAME = 'plan';

/** The thread key used while no thread exists yet. */
export const PLAN_NO_THREAD = 'no-thread';

/** The statuses, in the order the schema lists them. */
export const PLAN_STATUSES: readonly PlanStepStatus[] = ['todo', 'doing', 'done', 'blocked'];

/** The ids a step may have: short, no spaces. */
export const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

/** The heading the plan carries in a prompt. */
export const PLAN_PROMPT_HEADING = 'Your plan so far:';

/** Why a run was continued: the plan still has open steps, or none was made. */
export const PLAN_INCOMPLETE_REASON = 'plan-incomplete' as const;

/** The error code of a run that ended with the plan unfinished. */
export const PLAN_INCOMPLETE_CODE = 'PLAN_INCOMPLETE';

/** The prompt after a run that reported itself done while the orchestrator requires a plan and there is none. */
export const PLAN_REQUIRED_PROMPT =
  'This run requires a plan, and you made none. Do NOT finish yet: call task.plan set with the steps of the job ' +
  '(give a step a check where a command can prove it), work them in order, and mark each done with task.plan update.';

/** The tool's name. */
export const PLAN_TOOL_NAME = 'task.plan';

/**
 * The plan changes only the agent's own state, and a check runs the same way a
 * `--done-check` does, so every operation is `read`: it needs no grant. A check
 * the MODEL writes is held to the `command` grant and the executable allowlist
 * on top of that (see `task-plan-checks.ts`).
 */
export const PLAN_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  set: 'read',
  update: 'read',
  list: 'read',
  next: 'read',
};

/** What the model is told. */
export const PLAN_TOOL_DESCRIPTION =
  'Plan for a big job: not complete until every step is done. ' +
  `set {steps:[{id,title,check?:{executable,args[],timeoutMs?}}]} (max ${String(PLAN_MAX_STEPS)}; done steps are kept); ` +
  'update {id,status:todo|doing|done|blocked,note?}; list; next. A step with a check is done only when its check ' +
  'passes: update runs it (needs the command grant); a failure is returned and the step stays open.';

/** One schema for the four operations. */
export const PLAN_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          check: {
            type: 'object',
            properties: {
              executable: { type: 'string' },
              args: { type: 'array', items: { type: 'string' } },
              timeoutMs: { type: 'integer' },
            },
          },
        },
      },
    },
    id: { type: 'string' },
    status: { enum: PLAN_STATUSES },
    note: { type: 'string' },
  },
} as const;

/** The tool filter that keeps `task.plan` out of a run that did not ask for a plan. */
export const PLAN_TOOL_WITHHELD_PATTERN = `${PLAN_TOOL_NAME}.*`;
