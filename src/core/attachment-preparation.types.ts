import type { ChatAttachment } from './chat-attachment';

/** Why an attachment could not be sent. */
export type AttachmentRefusal = 'budget-exhausted' | 'model-cannot-see' | 'too-large';

/** One attachment, ready to send. */
export interface PreparedAttachment {
  attachment: ChatAttachment;
  /** Absent when the header could not be read, rather than guessed at. */
  estimatedTokens?: number;
}

/** What survived preparation, what did not, and what the images will cost. */
export interface AttachmentPreparation {
  prepared: PreparedAttachment[];
  refused: { filename: string; reason: AttachmentRefusal }[];
  estimatedImageTokens: number;
}
