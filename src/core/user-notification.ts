import { z } from 'zod';

/**
 * Why the user is being pulled back to the window.
 *
 * A tag rather than a message: the copy is localized, and localization lives
 * in the view layer. Core decides *whether* and *why*, never the wording.
 */
export type NotificationReason = 'approval' | 'completion' | 'failure' | 'question';

/** The slice of the extension snapshot a notification decision reads. */
export interface NotifiableState {
  readonly approvalRequestId: string | undefined;
  readonly questionRequestId: string | undefined;
  readonly busy: boolean;
  readonly lastError: string | undefined;
}

export const userNotificationInputSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    kind: z.enum(['info', 'warning']).default('info'),
  })
  .strict();

export type UserNotificationInput = z.infer<typeof userNotificationInputSchema>;

/**
 * Decides whether a state change is worth interrupting the user for.
 *
 * Nothing fires while the window has focus. A notification exists to say
 * "come back", and the user who is already looking at the panel can see the
 * approval, the question and the result without being told — a toast there is
 * pure noise, and noise is how people learn to ignore the channel that
 * matters.
 *
 * Order is by how stuck the run is, not by recency: an approval and a question
 * both block the run and outrank a result that has already landed, and a
 * failure outranks a plain completion because `busy` drops on both.
 */
export function notificationReasonForStateChange(
  previous: NotifiableState,
  next: NotifiableState,
  windowFocused: boolean,
): NotificationReason | undefined {
  if (windowFocused) return undefined;
  if (
    next.approvalRequestId !== undefined &&
    next.approvalRequestId !== previous.approvalRequestId
  ) {
    return 'approval';
  }
  if (
    next.questionRequestId !== undefined &&
    next.questionRequestId !== previous.questionRequestId
  ) {
    return 'question';
  }
  if (next.lastError !== undefined && next.lastError !== previous.lastError) return 'failure';
  if (previous.busy && !next.busy) return 'completion';
  return undefined;
}
