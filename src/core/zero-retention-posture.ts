import { samePosture } from './zero-retention';
import { ZERO_RETENTION_OFF } from './zero-retention.constants';

import type { ZeroRetentionListener, ZeroRetentionPosture } from './zero-retention.types';

/**
 * The one posture every persistence and network chokepoint reads.
 *
 * Process-wide on purpose. The backend client, the run journal and the
 * checkpoint store are built in different places and at different times, and a
 * posture threaded through each constructor would be one forgotten argument
 * away from a store that quietly keeps writing.
 */
export class ZeroRetentionPostureStore {
  private posture: ZeroRetentionPosture = ZERO_RETENTION_OFF;
  private readonly listeners = new Set<ZeroRetentionListener>();

  current(): ZeroRetentionPosture {
    return this.posture;
  }

  active(): boolean {
    return this.posture.active;
  }

  set(posture: ZeroRetentionPosture): void {
    if (samePosture(this.posture, posture)) return;
    this.posture = posture;
    for (const listener of this.listeners) listener(posture);
  }

  subscribe(listener: ZeroRetentionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const zeroRetentionPosture = new ZeroRetentionPostureStore();
