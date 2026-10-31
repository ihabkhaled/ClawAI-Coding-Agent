import {
  RUNTIME_STREAM_IDLE_MESSAGE,
  RUNTIME_STREAM_IDLE_STRIKES_BEFORE_FAILURE,
} from './runtime-stream-idle.constants';

import type { RuntimeDispatchState } from './runtime-event-stream.types';
import type {
  RuntimeStreamIdleTracker,
  RuntimeStreamIdleVerdict,
} from './runtime-stream-idle.types';

/**
 * The run's stream stayed connected (heartbeats kept flowing) but produced no
 * real event across the whole idle budget, including one re-attach.
 *
 * Distinct from a cancel on purpose: the user did not stop it. A caller shows
 * `RUNTIME_STREAM_IDLE_MESSAGE` (translated) rather than a cancelled state.
 */
export class RuntimeStreamIdleError extends Error {
  constructor(readonly idleMs: number) {
    super(RUNTIME_STREAM_IDLE_MESSAGE);
    this.name = 'RuntimeStreamIdleError';
  }
}

/**
 * Judges the idle window after a chunk. True means: close this stream and
 * reopen it from the cursor. Throws `RuntimeStreamIdleError` when a re-attach
 * already happened and a whole further window passed without a real event.
 */
export function reattachWhenIdle(
  tracker: RuntimeStreamIdleTracker,
  dispatchState: RuntimeDispatchState,
): boolean {
  const verdict = tracker.evaluate(dispatchState.pendingDispatches.size);
  if (verdict === 'fail') throw new RuntimeStreamIdleError(tracker.idleMs);
  return verdict === 'reattach';
}

/**
 * Tracks the last non-heartbeat event against an injectable clock.
 *
 * While a tool call is outstanding the window is held open, because the tool
 * runs locally and the backend has nothing to say until its result is posted.
 * The window restarts from the last moment a tool was seen outstanding.
 */
export function createRuntimeStreamIdleTracker(
  now: () => number,
  idleMs: number,
): RuntimeStreamIdleTracker {
  let lastActivityAt = now();
  let strikes = 0;
  return {
    idleMs,
    recordEvent(): void {
      lastActivityAt = now();
      strikes = 0;
    },
    evaluate(pendingToolCalls: number): RuntimeStreamIdleVerdict {
      const current = now();
      if (pendingToolCalls > 0) {
        lastActivityAt = current;
        return 'ok';
      }
      if (current - lastActivityAt < idleMs) return 'ok';
      strikes += 1;
      lastActivityAt = current;
      return strikes >= RUNTIME_STREAM_IDLE_STRIKES_BEFORE_FAILURE ? 'fail' : 'reattach';
    },
  };
}
