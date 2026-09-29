import type { Checkpoint, CheckpointFile } from '../core/checkpoint.types';
import type { ConversationAnchor } from '../core/conversation-rewind.types';

/** What creating and restoring checkpoints needs to reach. */
export interface CheckpointDependencies {
  /** The current contents of every file the agent has changed this session. */
  readonly touchedFiles: () => Promise<CheckpointFile[]>;
  readonly checkpoints: () => Checkpoint[];
  readonly save: (checkpoint: Checkpoint) => Promise<void>;
  readonly restore: (checkpoint: Checkpoint) => Promise<void>;
  /** Where the active conversation stands, recorded so a restore can rewind it. */
  readonly conversationAnchor?: () => Promise<ConversationAnchor | undefined>;
  /** Rewinds a conversation to an anchor; false when it was refused. */
  readonly rewindConversation?: (anchor: ConversationAnchor) => Promise<boolean>;
}
