import type { TeamBinding } from './agent-team-tool.types';
import type { AgentEvent } from './create-agent.types';

/** The smaller of the limits that are set: the run's own guard and the server's allowance. */
function tightest(...limits: readonly (number | undefined)[]): number | undefined {
  const set = limits.filter((limit): limit is number => limit !== undefined);
  return set.length === 0 ? undefined : Math.min(...set);
}

/**
 * What one run lets its team see: the run's signal and event sink, how many
 * calls it has made, and the tightest call and time limits it works under, so
 * a child's budget is carved from what the run really has left.
 */
export function teamBinding(input: {
  readonly signal: AbortSignal | undefined;
  readonly emit: (event: AgentEvent) => void;
  readonly callsSoFar: () => number;
  readonly guardCalls: number | undefined;
  readonly serverCalls: number | undefined;
  readonly maxDurationMs: number | undefined;
  readonly token: () => string | undefined;
}): TeamBinding {
  return {
    signal: input.signal,
    emit: input.emit,
    callsSoFar: input.callsSoFar,
    maxToolCalls: tightest(input.guardCalls, input.serverCalls),
    deadlineAt: input.maxDurationMs === undefined ? undefined : Date.now() + input.maxDurationMs,
    token: input.token,
  };
}
