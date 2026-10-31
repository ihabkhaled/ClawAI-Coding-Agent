import { describe, expect, it } from 'vitest';

import {
  createRuntimeStreamIdleTracker,
  reattachWhenIdle,
  RuntimeStreamIdleError,
} from '../../src/core/runtime/runtime-stream-idle';
import {
  RUNTIME_STREAM_IDLE_MESSAGE,
  RUNTIME_STREAM_IDLE_MS,
} from '../../src/core/runtime/runtime-stream-idle.constants';

import type { RuntimeDispatchState } from '../../src/core/runtime/runtime-event-stream.types';

const IDLE = 1_000;

function tracker() {
  const clock = { now: 0 };
  return { clock, idle: createRuntimeStreamIdleTracker(() => clock.now, IDLE) };
}

describe('runtime stream idle tracker', () => {
  it('defaults to a ten minute budget', () => {
    expect(RUNTIME_STREAM_IDLE_MS).toBe(600_000);
  });

  it('stays ok inside the window', () => {
    const { clock, idle } = tracker();
    clock.now = IDLE - 1;
    expect(idle.evaluate(0)).toBe('ok');
  });

  it('asks to reattach once, then fails after another full window', () => {
    const { clock, idle } = tracker();
    clock.now = IDLE;
    expect(idle.evaluate(0)).toBe('reattach');
    clock.now = IDLE + IDLE - 1;
    expect(idle.evaluate(0)).toBe('ok');
    clock.now = IDLE * 2;
    expect(idle.evaluate(0)).toBe('fail');
  });

  it('is reset by a real event, including the reattach strike', () => {
    const { clock, idle } = tracker();
    clock.now = IDLE;
    expect(idle.evaluate(0)).toBe('reattach');
    clock.now = IDLE + 10;
    idle.recordEvent();
    clock.now = IDLE * 2 + 9;
    expect(idle.evaluate(0)).toBe('ok');
    clock.now = IDLE * 2 + 10 + IDLE;
    expect(idle.evaluate(0)).toBe('reattach');
  });

  it('is not reset by evaluating alone, so heartbeats cannot hide a hang', () => {
    const { clock, idle } = tracker();
    for (let at = 100; at < IDLE; at += 100) {
      clock.now = at;
      expect(idle.evaluate(0)).toBe('ok');
    }
    clock.now = IDLE;
    expect(idle.evaluate(0)).toBe('reattach');
  });

  it('pauses while a tool call is outstanding and restarts the window after', () => {
    const { clock, idle } = tracker();
    clock.now = IDLE * 50;
    expect(idle.evaluate(1)).toBe('ok');
    clock.now = IDLE * 50 + IDLE - 1;
    expect(idle.evaluate(0)).toBe('ok');
    clock.now = IDLE * 51;
    expect(idle.evaluate(0)).toBe('reattach');
  });

  it('reattachWhenIdle reports true on reattach and throws the typed error on failure', () => {
    const { clock, idle } = tracker();
    const state = { pendingDispatches: new Set<Promise<void>>() } as RuntimeDispatchState;
    expect(reattachWhenIdle(idle, state)).toBe(false);
    clock.now = IDLE;
    expect(reattachWhenIdle(idle, state)).toBe(true);
    clock.now = IDLE * 2;
    let caught: unknown;
    try {
      reattachWhenIdle(idle, state);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuntimeStreamIdleError);
    expect((caught as RuntimeStreamIdleError).message).toBe(RUNTIME_STREAM_IDLE_MESSAGE);
    expect((caught as RuntimeStreamIdleError).idleMs).toBe(IDLE);
  });

  it('reattachWhenIdle holds the window open while a dispatch is pending', () => {
    const { clock, idle } = tracker();
    const state = {
      pendingDispatches: new Set<Promise<void>>([new Promise<void>(() => undefined)]),
    } as RuntimeDispatchState;
    clock.now = IDLE * 10;
    expect(reattachWhenIdle(idle, state)).toBe(false);
  });
});
