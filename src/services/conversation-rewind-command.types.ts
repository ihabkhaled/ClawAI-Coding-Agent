import type { Checkpoint } from '../core/checkpoint.types';
import type { RewindableMessage, ThreadRewindResult } from '../core/conversation-rewind.types';

/** What rewinding a conversation, and pairing it with a checkpoint, needs to reach. */
export interface ConversationRewindDependencies {
  /** The thread a chat panel session is showing, when the panel asked. */
  readonly threadForSession: (sessionId: string) => string | undefined;
  /** The thread of the focused (or most recent) panel, for the palette. */
  readonly activeThreadId: () => string | undefined;
  /** Whether a reply is still being written into the thread. */
  readonly isThreadBusy: (threadId: string) => boolean;
  readonly listMessages: (threadId: string) => Promise<RewindableMessage[]>;
  readonly rewindThread: (threadId: string, messageId: string) => Promise<ThreadRewindResult>;
  /** Re-renders every panel showing the thread from the server. */
  readonly reloadThread: (threadId: string) => Promise<void>;
  readonly checkpoints: () => Checkpoint[];
  /** Puts a checkpoint's files back through the previewed, undoable transaction. */
  readonly restoreCode: (checkpoint: Checkpoint) => Promise<void>;
}
