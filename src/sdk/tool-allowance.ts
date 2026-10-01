import type { RunBudgetTrip } from './run-budget.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

/**
 * The tool-call allowance a run finished by spending in full.
 *
 * The runtime tells the model its allowance and refuses call limit+1, so a model
 * that has used every call usually answers "done" rather than asking for one
 * more. The server then records an ordinary completion, and a run cut short by
 * its budget looks identical to one that finished. A run that ended on exactly
 * its limit is reported as the budget ending it, so it is not mistaken for
 * completion and auto-continue gets to carry on.
 */
export function spentToolAllowance(
  report: { readonly outcome: HeadlessOutcome; readonly toolCalls: number },
  limit: number | undefined,
): RunBudgetTrip | undefined {
  return report.outcome === 'completed' && limit !== undefined && report.toolCalls >= limit
    ? { budget: 'tool-calls', limit }
    : undefined;
}
