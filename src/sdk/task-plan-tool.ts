import { redactText } from '../core/redaction';
import { isAllowedExecutable } from '../headless/headless-command-policy';

import { runDoneChecks } from './done-checks';
import { formatPlan, progressLine } from './task-plan-prompt';
import {
  isStatus,
  mergedPlan,
  nextStep,
  parseNote,
  parseSteps,
  summarize,
} from './task-plan-steps';
import { PLAN_CHECK_TAIL_CHARS, PLAN_STATUSES } from './task-plan-tool.constants';

import type {
  PlanRefusal,
  PlanStep,
  PlanStepStatus,
  PlanStore,
  PlanTool,
  PlanToolDeps,
} from './task-plan-tool.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** The plan tool over one store: it sets steps, moves them, and proves a step before it is done. */
export function createPlanTool(store: PlanStore, deps: PlanToolDeps): PlanTool {
  const save = (steps: readonly PlanStep[]): void => {
    store.save(steps);
    deps.onChanged?.(summarize(steps));
  };
  return {
    execute: (operation, args, signal) => {
      if (operation === 'set') return setPlan(store, args, deps, save);
      if (operation === 'update') return updateStep(store, args, deps, save, signal);
      if (operation === 'list') return formatPlan(store.list());
      if (operation === 'next') return nextLine(store.list());
      throw new Error(`Unsupported operation ${operation}`);
    },
  };
}

function nextLine(steps: readonly PlanStep[]): string {
  const next = nextStep(steps);
  if (steps.length === 0) return 'No plan yet. Call set with the steps of the job.';
  if (next === undefined) return progressLine(steps);
  const check =
    next.check === undefined
      ? 'no check'
      : `check: ${[next.check.executable, ...next.check.args].join(' ')}`;
  return `${progressLine(steps)}\n${next.id} [${next.status}] ${next.title} (${check})`;
}

function setPlan(
  store: PlanStore,
  args: ToolArguments,
  deps: PlanToolDeps,
  save: (steps: readonly PlanStep[]) => void,
): string {
  const incoming = parseSteps(args.steps, false);
  for (const step of incoming) {
    if (step.check !== undefined) assertModelCheckAllowed(step.id, step.check, deps);
  }
  const existing = store.list();
  const merged = mergedPlan(existing, incoming);
  save(merged);
  const kept = merged.length - incoming.filter((step) => merged.includes(step)).length;
  const note = kept > 0 ? ` ${String(kept)} done or imposed step(s) were kept as they were.` : '';
  return `Plan saved: ${String(merged.length)} step(s).${note}\n${progressLine(merged)}`;
}

/** A check the model wrote needs the `command` grant and an allowed executable. */
function assertModelCheckAllowed(
  id: string,
  check: { readonly executable: string },
  deps: PlanToolDeps,
): void {
  if (!deps.modelChecks.allowed) {
    throw new Error(
      `Step "${id}": checks run commands, and this run has no command grant. Leave the check out; the orchestrator can supply it.`,
    );
  }
  if (!isAllowedExecutable(check.executable, deps.modelChecks.executables)) {
    throw new Error(
      `Step "${id}": "${check.executable}" is not an allowed command for a check (allowed: ${deps.modelChecks.executables.join(', ')}).`,
    );
  }
}

async function updateStep(
  store: PlanStore,
  args: ToolArguments,
  deps: PlanToolDeps,
  save: (steps: readonly PlanStep[]) => void,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const steps = store.list();
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const step = steps.find((entry) => entry.id === id);
  if (step === undefined) {
    const known = steps.map((entry) => entry.id).join(', ');
    throw new Error(
      `There is no step "${id}". Steps: ${known.length === 0 ? 'none (call set first)' : known}.`,
    );
  }
  const { status } = args;
  if (!isStatus(status)) {
    throw new Error(`update needs "status": one of ${PLAN_STATUSES.join(', ')}.`);
  }
  const note = parseNote(args.note);
  const verified = status === 'done' ? await proveStep(step, deps, signal) : undefined;
  if (typeof verified === 'object') return verified;
  const next: PlanStep = moved(step, status, note, verified !== undefined);
  // Read again: another call may have changed the plan while the check ran.
  const updated = store.list().map((entry) => (entry.id === id ? next : entry));
  save(updated);
  const proof = verified === undefined ? '' : ` ${verified}`;
  return `Step ${id} is ${status}.${proof}\n${progressLine(updated)}`;
}

function moved(
  step: PlanStep,
  status: PlanStepStatus,
  note: string | undefined,
  verified: boolean,
): PlanStep {
  return {
    id: step.id,
    title: step.title,
    ...(step.check === undefined ? {} : { check: step.check }),
    ...(step.locked === true ? { locked: true as const } : {}),
    status,
    ...(verified ? { verified: true as const } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Runs the step's check before it may be done. Nothing to prove returns
 * undefined; a pass returns a line saying so; a failure returns the refusal,
 * with the end of the check's output, and the step stays where it was. The
 * refusal is a result and not an error: an error message is cut to 400
 * characters on its way to the model, which would lose the end of the output,
 * the part that says what failed.
 */
async function proveStep(
  step: PlanStep,
  deps: PlanToolDeps,
  signal: AbortSignal | undefined,
): Promise<string | PlanRefusal | undefined> {
  const { check } = step;
  if (check === undefined) return undefined;
  if (step.locked !== true) {
    assertModelCheckAllowed(step.id, check, deps);
    const approve = deps.modelChecks.approve;
    if (approve !== undefined && !(await approve(check, step.id))) {
      throw new Error(`The check for step "${step.id}" was not approved, so the step stays open.`);
    }
  }
  const report = await runDoneChecks([{ label: step.id, ...check }], deps.workspace, signal);
  const [outcome] = report.checks;
  if (!outcome?.ok) {
    const output =
      outcome === undefined ? '' : redactText(outcome.output.slice(-PLAN_CHECK_TAIL_CHARS));
    const exit = outcome === undefined ? -1 : outcome.exitCode;
    return {
      refused: true,
      step: step.id,
      status: step.status,
      message: `Step "${step.id}" is NOT done: its check failed (exit ${String(exit)}). Fix the work, then mark it done again.`,
      checkOutputEnd: output,
    };
  }
  return `Its check passed (${String(outcome.durationMs)} ms).`;
}
