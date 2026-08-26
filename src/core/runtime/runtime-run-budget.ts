import { parseRunBudget, type RunBudget } from './runtime-tool-contracts';

/**
 * A run that ran out of an allowance rather than one that broke.
 *
 * Exhaustion used to surface as a bare `Error`. Nothing upstream could tell it
 * apart from a crash, so no terminal event was published, the run was
 * compensated with a cancel, and the activity panel kept a live spinner over a
 * run that had already stopped — three supervised sessions in a row ended that
 * way with no reason on screen. The type carries the limit that was reached so
 * the run can end as `run.failed` with a reason a reader can act on.
 */
export class RuntimeBudgetExhaustedError extends Error {
  readonly code = 'RUNTIME_BUDGET_EXHAUSTED';

  constructor(readonly limit: string) {
    super(`Runtime run exceeded its ${limit} budget`);
    this.name = 'RuntimeBudgetExhaustedError';
  }
}

export interface RuntimeBudgetUsage {
  readonly modelTurns: number;
  readonly toolCalls: number;
  readonly toolRounds: number;
  readonly repairAttempts: number;
  readonly outputBytes: number;
  readonly toolResultBytes: number;
}

export interface RuntimeBudgetState {
  readonly budget: RunBudget;
  readonly startedAtMs: number;
  readonly usage: RuntimeBudgetUsage;
}

export type RuntimeBudgetDebit = Partial<RuntimeBudgetUsage>;

const emptyUsage: RuntimeBudgetUsage = {
  modelTurns: 0,
  toolCalls: 0,
  toolRounds: 0,
  repairAttempts: 0,
  outputBytes: 0,
  toolResultBytes: 0,
};

const usageLimits: Readonly<
  Record<keyof RuntimeBudgetUsage, { readonly budget: keyof RunBudget; readonly label: string }>
> = {
  modelTurns: { budget: 'maxModelTurns', label: 'model turn' },
  toolCalls: { budget: 'maxToolCalls', label: 'tool call' },
  toolRounds: { budget: 'maxToolRounds', label: 'tool round' },
  repairAttempts: { budget: 'maxRepairAttempts', label: 'repair attempt' },
  outputBytes: { budget: 'maxOutputBytes', label: 'output byte' },
  toolResultBytes: { budget: 'maxToolResultBytes', label: 'tool result byte' },
};

export function createRuntimeBudgetState(
  value: RunBudget,
  startedAtMs: number,
): RuntimeBudgetState {
  if (!Number.isFinite(startedAtMs)) {
    throw new Error('Runtime budget clock must be finite');
  }
  return {
    budget: parseRunBudget(value),
    startedAtMs,
    usage: emptyUsage,
  };
}

function debitValue(value: number | undefined): number {
  const debit = value ?? 0;
  if (!Number.isInteger(debit)) {
    throw new Error('Runtime budget debit must be an integer');
  }
  if (debit < 0) {
    throw new Error('Runtime budget debit must be nonnegative');
  }
  return debit;
}

function assertClock(state: RuntimeBudgetState, nowMs: number): void {
  if (!Number.isFinite(nowMs) || nowMs < state.startedAtMs) {
    throw new Error('Runtime budget clock cannot move backwards');
  }
  if (nowMs - state.startedAtMs > state.budget.maxRuntimeMs) {
    throw new RuntimeBudgetExhaustedError('wall-clock');
  }
}

export function consumeRuntimeBudget(
  state: RuntimeBudgetState,
  debit: RuntimeBudgetDebit,
  nowMs: number,
): RuntimeBudgetState {
  assertClock(state, nowMs);
  const consume = (key: keyof RuntimeBudgetUsage): number => {
    const limit = usageLimits[key];
    const next = state.usage[key] + debitValue(debit[key]);
    if (next > state.budget[limit.budget]) {
      throw new RuntimeBudgetExhaustedError(limit.label);
    }
    return next;
  };
  const nextUsage: RuntimeBudgetUsage = {
    modelTurns: consume('modelTurns'),
    toolCalls: consume('toolCalls'),
    toolRounds: consume('toolRounds'),
    repairAttempts: consume('repairAttempts'),
    outputBytes: consume('outputBytes'),
    toolResultBytes: consume('toolResultBytes'),
  };

  return { ...state, usage: nextUsage };
}
