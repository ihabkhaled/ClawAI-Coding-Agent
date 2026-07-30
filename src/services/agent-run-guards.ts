import type { EditPlan } from '../core/edit-plan';

export function hasNoPlannedActions(plan: EditPlan): boolean {
  return plan.files.length === 0 && (plan.commands?.length ?? 0) === 0;
}

export function enforcePostEditCancellation(signal: AbortSignal, committed: boolean): void {
  if (signal.aborted && !committed) {
    signal.throwIfAborted();
  }
}

export function shouldRunCommands(signal: AbortSignal, plan: EditPlan, applied: boolean): boolean {
  return !signal.aborted && applied && (plan.commands?.length ?? 0) > 0;
}
