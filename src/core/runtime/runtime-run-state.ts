import {
  RUNTIME_BUDGET_EXHAUSTED_CODE,
  RUNTIME_OBSERVATION_EVENTS,
  RUNTIME_RUN_ENDING_EVENTS,
  RUNTIME_RUN_TRANSITIONS,
  RUNTIME_STATUS_TO_RUN_STATE,
  RUNTIME_TERMINAL_RUN_STATES,
} from './runtime-run-state.constants';

import type { RuntimeRunStatus } from './runtime-event-reducer';
import type {
  RuntimeRunState,
  RuntimeRunTransitionEvent,
  RuntimeRunTransitionResult,
} from './runtime-run-state.types';

export function isTerminalRunState(state: RuntimeRunState): boolean {
  return RUNTIME_TERMINAL_RUN_STATES.some((terminal) => terminal === state);
}

function isObservation(event: RuntimeRunTransitionEvent): boolean {
  return RUNTIME_OBSERVATION_EVENTS.some((observation) => observation === event);
}

function endingState(event: RuntimeRunTransitionEvent): RuntimeRunState | undefined {
  return Object.hasOwn(RUNTIME_RUN_ENDING_EVENTS, event)
    ? RUNTIME_RUN_ENDING_EVENTS[event as keyof typeof RUNTIME_RUN_ENDING_EVENTS]
    : undefined;
}

/**
 * The next state, or a typed refusal. Pure: no clock, no I/O.
 *
 * Terminal states accept nothing. Observations never move a live state.
 * Failure, block, cancel and budget exhaustion end any live run.
 */
export function transition(
  state: RuntimeRunState,
  event: RuntimeRunTransitionEvent,
): RuntimeRunTransitionResult {
  if (isTerminalRunState(state)) {
    return { ok: false, reason: 'terminal-state', from: state, event };
  }
  if (isObservation(event)) return { ok: true, state };
  const ending = endingState(event);
  if (ending !== undefined) return { ok: true, state: ending };
  const moves = RUNTIME_RUN_TRANSITIONS[state] ?? {};
  const next = Object.hasOwn(moves, event) ? moves[event] : undefined;
  if (next === undefined) return { ok: false, reason: 'illegal-transition', from: state, event };
  return { ok: true, state: next };
}

/** Maps a reducer status (and the failure code, when known) onto the twelve states. */
export function runStateFromStatus(
  status: RuntimeRunStatus,
  failureCode?: string,
): RuntimeRunState {
  if (status === 'failed' && failureCode === RUNTIME_BUDGET_EXHAUSTED_CODE) {
    return 'BUDGET_EXHAUSTED';
  }
  return RUNTIME_STATUS_TO_RUN_STATE[status];
}
