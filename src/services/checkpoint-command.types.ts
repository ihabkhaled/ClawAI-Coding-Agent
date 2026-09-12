import type { Checkpoint, CheckpointFile } from '../core/checkpoint.types';

/** What creating and restoring checkpoints needs to reach. */
export interface CheckpointDependencies {
  /** The current contents of every file the agent has changed this session. */
  readonly touchedFiles: () => Promise<CheckpointFile[]>;
  readonly checkpoints: () => Checkpoint[];
  readonly save: (checkpoint: Checkpoint) => Promise<void>;
  readonly restore: (checkpoint: Checkpoint) => Promise<void>;
}
