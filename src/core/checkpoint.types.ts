import type { ConversationAnchor } from './conversation-rewind.types';

/** One file's contents at the moment a checkpoint was taken. */
export interface CheckpointFile {
  rootKey: string;
  path: string;
  content: string;
}

/** A named snapshot of the files the agent has changed. */
export interface Checkpoint {
  id: string;
  label: string;
  createdAt: number;
  files: CheckpointFile[];
  /** Where the conversation stood, so a restore can rewind it too. */
  conversation?: ConversationAnchor | undefined;
}
