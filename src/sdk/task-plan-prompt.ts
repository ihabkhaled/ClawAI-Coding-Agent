import { nextStep, summarize } from './task-plan-steps';
import {
  PLAN_PROMPT_HEADING,
  PLAN_PROMPT_MAX_CHARS,
  PLAN_REQUIRED_PROMPT,
} from './task-plan-tool.constants';

import type { PlanGateReport, PlanStep, PlanStepCheck, PlanStore } from './task-plan-tool.types';

/** The command a check runs, as one short phrase. */
export function describeCheck(check: PlanStepCheck): string {
  return [check.executable, ...check.args].join(' ').slice(0, 120);
}

function stepLine(step: PlanStep, brief: boolean): string {
  const state = step.verified === true ? `${step.status}, verified` : step.status;
  if (brief && step.status === 'done') return `${step.id} [${state}]`;
  const check = step.check === undefined ? '' : ` (check: ${describeCheck(step.check)})`;
  const note = step.note === undefined ? '' : ` -- ${step.note}`;
  return `${step.id} [${state}] ${step.title}${check}${note}`;
}

/** The steps as lines; done steps shrink to their ids when the plan would not fit. */
export function formatPlan(steps: readonly PlanStep[], limit = PLAN_PROMPT_MAX_CHARS): string {
  if (steps.length === 0) return 'No plan.';
  const full = steps.map((step) => stepLine(step, false)).join('\n');
  if (full.length <= limit) return full;
  return steps
    .map((step) => stepLine(step, true))
    .join('\n')
    .slice(0, limit);
}

/** How far along the plan is, and what comes next. */
export function progressLine(steps: readonly PlanStep[]): string {
  const summary = summarize(steps);
  const next = nextStep(steps);
  const tail = next === undefined ? 'All steps are done.' : `Next: ${next.id} - ${next.title}`;
  return `${String(summary.done)}/${String(summary.total)} done. ${tail}`;
}

/** The plan as a prompt section, or an empty string when there is none. */
export function planSection(store: PlanStore): string {
  const steps = store.list();
  return steps.length === 0 ? '' : `${PLAN_PROMPT_HEADING}\n${formatPlan(steps)}`;
}

/** `prompt` with the plan appended, or unchanged when there is none or the prompt already carries it. */
export function promptWithPlan(prompt: string, store: PlanStore): string {
  if (prompt.includes(PLAN_PROMPT_HEADING)) return prompt;
  const section = planSection(store);
  return section.length === 0 ? prompt : `${prompt}\n\n${section}`;
}

/**
 * What the completion gate says about the plan: nothing when it is finished, or
 * when none exists and none is required; otherwise the prompt that sends the
 * model back to the open steps (the plan itself comes with the prompt).
 */
export function planGateReport(store: PlanStore, required: boolean): PlanGateReport | undefined {
  const steps = store.list();
  if (steps.length === 0) {
    return required ? { open: 0, total: 0, prompt: PLAN_REQUIRED_PROMPT } : undefined;
  }
  const open = steps.filter((step) => step.status !== 'done');
  if (open.length === 0) return undefined;
  const head =
    `You reported the task as done, but your plan still has ${String(open.length)} open step(s) ` +
    `of ${String(steps.length)}. Do NOT finish until every step is done: work the next open step, then ` +
    'mark it done with task.plan update (a step with a check is done only once its check passes). If a step truly cannot be done, mark it blocked with a note saying why, and finish with an honest report.';
  return {
    open: open.length,
    total: steps.length,
    prompt: `${head}\n\n${PLAN_PROMPT_HEADING}\n${formatPlan(steps)}`,
  };
}
