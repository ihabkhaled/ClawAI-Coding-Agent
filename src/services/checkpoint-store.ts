import { checkpointSchema, retainCheckpoints } from '../core/checkpoint';

import type { CheckpointStoragePort } from './checkpoint-store.types';
import type { Checkpoint } from '../core/checkpoint.types';

/** Where the index of checkpoints lives. Workspace-scoped: so are the files. */
export const CHECKPOINTS_KEY = 'clawAI.checkpoints';

/**
 * The named snapshots this workspace can be restored to.
 *
 * Kept in workspace storage rather than on the server, because a checkpoint is
 * the contents of files on this machine and sending them somewhere to make an
 * undo work would be a surprising thing for an undo to do.
 *
 * An entry that no longer parses is dropped rather than repaired. A checkpoint
 * is a promise to put files back exactly as they were; a half-read one cannot
 * keep that promise, and restoring from it would be worse than not having it.
 */
export class CheckpointStore {
  constructor(private readonly storage: CheckpointStoragePort) {}

  read(): Checkpoint[] {
    const raw = this.storage.get(CHECKPOINTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const parsed = checkpointSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async add(checkpoint: Checkpoint): Promise<void> {
    await this.storage.update(CHECKPOINTS_KEY, retainCheckpoints(this.read(), checkpoint));
  }

  async clear(): Promise<void> {
    await this.storage.update(CHECKPOINTS_KEY, []);
  }
}
