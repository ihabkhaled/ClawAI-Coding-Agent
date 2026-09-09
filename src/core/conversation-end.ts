import { z } from 'zod';

export const conversationEndInputSchema = z
  .object({
    reason: z.string().trim().min(1).max(2_000),
    lifecycle: z.enum(['completed', 'abandoned']).default('completed'),
  })
  .strict();

export type ConversationEndInput = z.infer<typeof conversationEndInputSchema>;

/** What the user still owes an answer to, if anything. */
export interface PendingInterruptions {
  readonly approvalTitle: string | undefined;
  readonly questionHeader: string | undefined;
}

export type ConversationEndDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly refusal: string };

/**
 * Refuses to end while the user still owes an answer.
 *
 * There is deliberately no force flag. An approval and a question are both
 * on screen waiting for a person, and a run that could end past either would
 * leave someone answering a prompt for work that had already stopped — which
 * is exactly the state the safeguard is named for. A model that wants to end
 * anyway can withdraw its own request first; nothing here needs an override.
 *
 * The approval is checked before the question only so the message names one
 * thing; both block, and resolving one surfaces the other.
 */
export function decideConversationEnd(pending: PendingInterruptions): ConversationEndDecision {
  if (pending.approvalTitle !== undefined) {
    return {
      allowed: false,
      refusal: `An approval is still open: ${pending.approvalTitle}. Wait for it to settle, or withdraw the request, before ending.`,
    };
  }
  if (pending.questionHeader !== undefined) {
    return {
      allowed: false,
      refusal: `A question is still open: ${pending.questionHeader}. Wait for the answer before ending.`,
    };
  }
  return { allowed: true };
}
