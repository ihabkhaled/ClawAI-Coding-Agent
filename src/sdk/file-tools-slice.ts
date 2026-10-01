import { setImmediate as yieldTurn } from 'node:timers/promises';

import { FILE_SLICE_MS } from './file-tools.constants';

/**
 * A checkpoint for long synchronous loops. Call it per unit of work: once a
 * slice has run for `FILE_SLICE_MS` it yields to the event loop, so a cancel
 * or `--max-duration` timer can fire, and it stops the loop when aborted.
 */
export function createSlicer(signal: AbortSignal | undefined): () => Promise<void> {
  let sliceStart = Date.now();
  return async () => {
    signal?.throwIfAborted();
    if (Date.now() - sliceStart < FILE_SLICE_MS) return;
    await yieldTurn();
    signal?.throwIfAborted();
    sliceStart = Date.now();
  };
}
