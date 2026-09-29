/** Where a conversation stood when something was remembered: its newest message. */
export interface ConversationAnchor {
  threadId: string;
  messageId: string;
}

/** What `clawAI.rewindConversation` may be invoked with from the chat panel. */
export interface RewindRequest {
  readonly sessionId?: string | undefined;
  readonly messageId?: string | undefined;
}

/** What `POST /chat-threads/:id/rewind` answers. */
export interface ThreadRewindResult {
  readonly threadId: string;
  readonly afterMessageId: string;
  readonly removedCount: number;
}

/** What a rewind or a checkpoint restore puts back. */
export type RewindScope = 'code' | 'conversation' | 'both';

/** One message as the rewind picker needs it. */
export interface RewindableMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt?: string | Date | undefined;
}
