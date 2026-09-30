import type { AgentToolkit } from './agent-sdk.types';
import type { RunBudgetLimits, RunBudgetTrip } from './run-budget.types';

/** The message a caller reads in `result.error` when a guard stopped the run. */
export function describeBudgetTrip(trip: RunBudgetTrip): string {
  return trip.budget === 'tool-calls'
    ? `Stopped: the run asked for more than ${String(trip.limit)} tool call(s).`
    : `Stopped: the run was still going after ${String(trip.limit / 1_000)} second(s).`;
}

/** Throws when a guard is unusable, so a bad value fails before the run, not during it. */
export function assertRunLimits(limits: RunBudgetLimits): void {
  const bad = (value: number | undefined): boolean =>
    value !== undefined && (!Number.isInteger(value) || value < 1);
  if (bad(limits.maxToolCalls))
    throw new RangeError('maxToolCalls must be a whole number, 1 or more.');
  if (bad(limits.maxDurationMs))
    throw new RangeError('maxDurationMs must be a whole number, 1 or more.');
}

export interface RunGuard {
  /** The signal the run must use: the caller's, aborted as well when a guard trips. */
  readonly signal: AbortSignal | undefined;
  readonly tripped: () => RunBudgetTrip | undefined;
  /** Counts each call the model requests and refuses the one past the limit. */
  readonly guard: (toolkit: AgentToolkit) => AgentToolkit;
  readonly dispose: () => void;
}

/**
 * Stops a run that has spent a limit the runtime does not report on.
 *
 * Runtime events carry turns and bytes, but no cost, so the guards are on what
 * this side can see: tool calls requested, and wall-clock time. Tripping aborts
 * the run's signal, so an in-flight tool call is cancelled and the stream is
 * closed; the caller reads the trip and reports `exhausted`, not `cancelled`.
 * The call past the limit is refused, never executed.
 */
export function createRunGuard(limits: RunBudgetLimits, external?: AbortSignal): RunGuard {
  if (limits.maxToolCalls === undefined && limits.maxDurationMs === undefined) {
    return {
      signal: external,
      tripped: () => undefined,
      guard: (toolkit) => toolkit,
      dispose: () => undefined,
    };
  }
  const controller = new AbortController();
  let trip: RunBudgetTrip | undefined;
  const trigger = (next: RunBudgetTrip): void => {
    trip ??= next;
    controller.abort();
  };
  const forward = (): void => {
    controller.abort();
  };
  external?.addEventListener('abort', forward, { once: true });
  if (external?.aborted === true) controller.abort();
  const timer =
    limits.maxDurationMs === undefined
      ? undefined
      : setTimeout(() => {
          trigger({ budget: 'duration', limit: limits.maxDurationMs ?? 0 });
        }, limits.maxDurationMs);
  timer?.unref();
  let requested = 0;
  return {
    signal: controller.signal,
    tripped: () => trip,
    guard: (toolkit) => ({
      ...toolkit,
      authorize: async (call) => {
        requested += 1;
        if (limits.maxToolCalls !== undefined && requested > limits.maxToolCalls) {
          trigger({ budget: 'tool-calls', limit: limits.maxToolCalls });
          return false;
        }
        return toolkit.authorize === undefined ? true : toolkit.authorize(call);
      },
    }),
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', forward);
    },
  };
}
