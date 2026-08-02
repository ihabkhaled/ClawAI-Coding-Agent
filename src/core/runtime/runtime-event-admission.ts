import { runtimeEpochsMatch } from './runtime-event-identity';

import type { RuntimeRunSnapshot } from './runtime-event-reducer';
import type { RuntimeEvent } from './runtime-protocol.schemas';

export function assertRuntimeEventCanAppend(
  existingRun: RuntimeRunSnapshot,
  event: RuntimeEvent,
): void {
  const expectedSequence = existingRun.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `Runtime event sequence must advance from ${String(existingRun.lastSequence)} to ${String(expectedSequence)} for run ${event.runId}`,
    );
  }
  if (!runtimeEpochsMatch(existingRun.epochs, event.epochs)) {
    throw new Error(`Runtime event epochs changed for run ${event.runId}`);
  }
  if (['completed', 'blocked', 'failed', 'cancelled'].includes(existingRun.status)) {
    throw new Error(`Runtime run ${event.runId} is already terminal`);
  }
}

export function assertRuntimeEventCanCreate(event: RuntimeEvent): void {
  if (event.sequence !== 0 || event.type !== 'run.created') {
    throw new Error(`Runtime run ${event.runId} must begin with run.created at sequence 0`);
  }
}
