import { z } from 'zod';

import type { Checkpoint } from './checkpoint.types';
import type {
  ConversationAnchor,
  RewindableMessage,
  RewindRequest,
} from './conversation-rewind.types';

/** How long a message preview in the rewind picker may be. */
export const REWIND_PREVIEW_LENGTH = 80;

export const conversationAnchorSchema = z
  .object({
    threadId: z.string().min(1).max(255),
    messageId: z.string().min(1).max(255),
  })
  .strict();

/**
 * The argument the chat panel passes to the rewind command.
 *
 * Parsed rather than trusted: a command can be run from anywhere with any
 * argument, and a malformed one must fall back to the palette flow instead of
 * rewinding the wrong conversation.
 */
export const rewindRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(255).optional(),
    messageId: z.string().min(1).max(255).optional(),
  })
  .strict();

export const threadRewindResultSchema = z
  .object({
    threadId: z.string(),
    afterMessageId: z.string(),
    removedCount: z.number().int().nonnegative(),
  })
  .loose();

export function parseRewindRequest(value: unknown): RewindRequest {
  const parsed = rewindRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function timeOf(message: RewindableMessage): number {
  const at = message.createdAt;
  if (at === undefined) return 0;
  const time = at instanceof Date ? at.getTime() : Date.parse(at);
  return Number.isNaN(time) ? 0 : time;
}

/** Messages oldest first, whatever order the page came back in. */
export function chronological(messages: readonly RewindableMessage[]): RewindableMessage[] {
  return [...messages].sort((left, right) => timeOf(left) - timeOf(right));
}

/**
 * The anchor a new checkpoint records: the newest message in the thread.
 *
 * Rewinding to it later puts the conversation back where it stood when the
 * code was remembered, which is what lets one action restore both.
 */
export function newestAnchor(
  threadId: string,
  messages: readonly RewindableMessage[],
): ConversationAnchor | undefined {
  const newest = chronological(messages).at(-1);
  return newest === undefined ? undefined : { threadId, messageId: newest.id };
}

/** The newest checkpoint remembered at exactly this point in this thread. */
export function checkpointAt(
  checkpoints: readonly Checkpoint[],
  anchor: ConversationAnchor,
): Checkpoint | undefined {
  return checkpoints.find(
    (checkpoint) =>
      checkpoint.conversation?.threadId === anchor.threadId &&
      checkpoint.conversation.messageId === anchor.messageId,
  );
}

/** One line of a message, short enough for a picker row. */
export function messagePreview(content: string): string {
  const line = content.replace(/\s+/gu, ' ').trim();
  return line.length > REWIND_PREVIEW_LENGTH
    ? `${line.slice(0, REWIND_PREVIEW_LENGTH - 1)}…`
    : line;
}
