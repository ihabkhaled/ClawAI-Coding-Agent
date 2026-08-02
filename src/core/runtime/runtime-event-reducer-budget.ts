import type { RuntimeBudgetUsage } from './runtime-run-budget';
import type { RunBudget } from './runtime-tool-contracts';

export function usageWithinLimits(usage: RuntimeBudgetUsage, limits: RunBudget): boolean {
  return (
    usage.modelTurns <= limits.maxModelTurns &&
    usage.outputBytes <= limits.maxOutputBytes &&
    usage.repairAttempts <= limits.maxRepairAttempts &&
    usage.toolCalls <= limits.maxToolCalls &&
    usage.toolResultBytes <= limits.maxToolResultBytes &&
    usage.toolRounds <= limits.maxToolRounds
  );
}

export function sameBudgetLimits(left: RunBudget, right: RunBudget): boolean {
  return (
    left.maxModelTurns === right.maxModelTurns &&
    left.maxOutputBytes === right.maxOutputBytes &&
    left.maxRepairAttempts === right.maxRepairAttempts &&
    left.maxRuntimeMs === right.maxRuntimeMs &&
    left.maxToolCalls === right.maxToolCalls &&
    left.maxToolResultBytes === right.maxToolResultBytes &&
    left.maxToolRounds === right.maxToolRounds
  );
}

export function usageDoesNotRegress(
  previous: RuntimeBudgetUsage,
  next: RuntimeBudgetUsage,
): boolean {
  return (
    next.modelTurns >= previous.modelTurns &&
    next.outputBytes >= previous.outputBytes &&
    next.repairAttempts >= previous.repairAttempts &&
    next.toolCalls >= previous.toolCalls &&
    next.toolResultBytes >= previous.toolResultBytes &&
    next.toolRounds >= previous.toolRounds
  );
}
