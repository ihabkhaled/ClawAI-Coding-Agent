/** Which run guard tripped. */
export type RunBudgetKind = 'tool-calls' | 'duration';

/** A guard that stopped the run: `limit` is a call count, or milliseconds for `duration`. */
export interface RunBudgetTrip {
  readonly budget: RunBudgetKind;
  readonly limit: number;
}

export interface RunBudgetLimits {
  readonly maxToolCalls?: number | undefined;
  readonly maxDurationMs?: number | undefined;
}
