import { describe, expect, it } from 'vitest';

import {
  isTerminalRunState,
  runStateFromStatus,
  transition,
} from '../../src/core/runtime/runtime-run-state';
import {
  RUNTIME_OBSERVATION_EVENTS,
  RUNTIME_RUN_ENDING_EVENTS,
  RUNTIME_RUN_STATES,
  RUNTIME_RUN_TRANSITION_EVENTS,
  RUNTIME_RUN_TRANSITIONS,
  RUNTIME_TERMINAL_RUN_STATES,
} from '../../src/core/runtime/runtime-run-state.constants';

import type { RuntimeRunState } from '../../src/core/runtime/runtime-run-state.types';

const live = RUNTIME_RUN_STATES.filter((state) => !isTerminalRunState(state));
const pairs = RUNTIME_RUN_STATES.flatMap((state) =>
  RUNTIME_RUN_TRANSITION_EVENTS.map((event) => [state, event] as const),
);

function expected(state: RuntimeRunState, event: string): RuntimeRunState | undefined {
  if (isTerminalRunState(state)) return undefined;
  if ((RUNTIME_OBSERVATION_EVENTS as readonly string[]).includes(event)) return state;
  if (event in RUNTIME_RUN_ENDING_EVENTS) {
    return RUNTIME_RUN_ENDING_EVENTS[event as keyof typeof RUNTIME_RUN_ENDING_EVENTS];
  }
  return RUNTIME_RUN_TRANSITIONS[state]?.[event];
}

describe('run state transition table', () => {
  it('has twelve states and four terminal ones', () => {
    expect(RUNTIME_RUN_STATES).toHaveLength(12);
    expect([...RUNTIME_TERMINAL_RUN_STATES].sort()).toEqual([
      'BUDGET_EXHAUSTED',
      'CANCELLED',
      'COMPLETED',
      'FAILED',
    ]);
  });

  it.each(pairs)('%s + %s agrees with the table', (state, event) => {
    const result = transition(state, event);
    const want = expected(state, event);
    if (want === undefined) {
      expect(result).toEqual({
        ok: false,
        reason: isTerminalRunState(state) ? 'terminal-state' : 'illegal-transition',
        from: state,
        event,
      });
    } else {
      expect(result).toEqual({ ok: true, state: want });
    }
  });

  it('every legal transition in the table lands on a known state', () => {
    for (const moves of Object.values(RUNTIME_RUN_TRANSITIONS)) {
      for (const target of Object.values(moves)) expect(RUNTIME_RUN_STATES).toContain(target);
    }
  });

  it('terminal states accept every event with a typed refusal', () => {
    for (const state of RUNTIME_TERMINAL_RUN_STATES) {
      for (const event of RUNTIME_RUN_TRANSITION_EVENTS) {
        expect(transition(state, event)).toEqual({
          ok: false,
          reason: 'terminal-state',
          from: state,
          event,
        });
      }
    }
  });

  it('reasoning, status, text and heartbeat never change a live state', () => {
    for (const state of live) {
      for (const event of RUNTIME_OBSERVATION_EVENTS) {
        expect(transition(state, event)).toEqual({ ok: true, state });
      }
    }
  });

  it('every live state can be failed, blocked, cancelled and budget-ended', () => {
    for (const state of live) {
      expect(transition(state, 'run.failed')).toEqual({ ok: true, state: 'FAILED' });
      expect(transition(state, 'run.blocked')).toEqual({ ok: true, state: 'FAILED' });
      expect(transition(state, 'run.cancelled')).toEqual({ ok: true, state: 'CANCELLED' });
      expect(transition(state, 'budget.exhausted')).toEqual({
        ok: true,
        state: 'BUDGET_EXHAUSTED',
      });
    }
  });

  it('refuses to skip ahead', () => {
    expect(transition('CREATED', 'run.completed').ok).toBe(false);
    expect(transition('RUNNING', 'approval.resolved').ok).toBe(false);
    expect(transition('PAUSED', 'tool.completed').ok).toBe(false);
  });

  it('walks a normal run from CREATED to COMPLETED', () => {
    let state: RuntimeRunState = 'CREATED';
    for (const event of [
      'plan.started',
      'run.started',
      'tool.requested',
      'approval.requested',
      'approval.resolved',
      'tool.completed',
      'verify.started',
      'verify.passed',
    ] as const) {
      const result = transition(state, event);
      expect(result.ok).toBe(true);
      if (result.ok) state = result.state;
    }
    expect(state).toBe('COMPLETED');
  });
});

describe('reducer status mapping', () => {
  it.each([
    ['running', undefined, 'RUNNING'],
    ['completed', undefined, 'COMPLETED'],
    ['blocked', undefined, 'FAILED'],
    ['failed', undefined, 'FAILED'],
    ['cancelled', undefined, 'CANCELLED'],
    ['failed', 'RUNTIME_BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED'],
    ['blocked', 'RUNTIME_BUDGET_EXHAUSTED', 'FAILED'],
  ] as const)('%s (%s) maps to %s', (status, code, state) => {
    expect(runStateFromStatus(status, code)).toBe(state);
  });
});
