import type { FlagshipAcceptanceReceipt } from './flagship-delivery';

interface IntegrationGateResult {
  readonly gateId: string;
  readonly passed: boolean;
}

/**
 * Turns the trusted host's gate results into acceptance receipts.
 *
 * The host runs the gates; the model never sees or signs them. Recording each
 * result on the snapshot is what makes "the gates passed" checkable after the
 * fact rather than a claim in a summary string, and it keeps a failed gate in
 * the record instead of collapsing it into a status.
 */
export function acceptanceReceiptsFrom(
  integrationId: string,
  gates: readonly IntegrationGateResult[],
): readonly FlagshipAcceptanceReceipt[] {
  return gates.map((gate) => ({
    receiptId: `${integrationId}-${gate.gateId}`,
    gateId: gate.gateId,
    status: gate.passed ? ('passed' as const) : ('failed' as const),
    evidenceReference: `integration:${integrationId}`,
  }));
}

/** Human-readable progress for an implementation graph, naming any replan scope. */
export function graphSummaryLine(
  taskCount: number,
  outcomeCount: number,
  status: string,
  replanScope: readonly string[],
): string {
  const progress = `${String(outcomeCount)}/${String(taskCount)} terminal tasks`;
  if (replanScope.length === 0) return `Implementation graph ${status}: ${progress}`;
  return `Implementation graph ${status}: ${progress}; replan scope: ${replanScope.join(', ')}`;
}

/**
 * A coordinator result is only usable when it reports each admitted task
 * exactly once — no duplicates, no strangers, nothing missing.
 */
export function outcomeIdentitiesMatch(
  taskIds: readonly string[],
  outcomeIds: readonly string[],
): boolean {
  if (outcomeIds.length !== taskIds.length) return false;
  const expected = new Set(taskIds);
  const actual = new Set(outcomeIds);
  return actual.size === outcomeIds.length && [...actual].every((taskId) => expected.has(taskId));
}

/**
 * One task's slice of a whole-number budget.
 *
 * The remainder is spread over the leading tasks so the shares always add back
 * up to the total, rather than rounding a unit away from every task.
 */
export function budgetShare(total: number, count: number, index: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}
