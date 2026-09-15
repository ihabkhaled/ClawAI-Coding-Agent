import { feedbackTicketSchema, type FeedbackTicket, type FeedbackType } from './contracts';

import type { z } from 'zod';

type PostRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST'; body: unknown; signal?: AbortSignal },
) => Promise<T>;

export interface FeedbackSubmission {
  readonly type: FeedbackType;
  readonly title: string;
  readonly contentMarkdown: string;
  readonly signal?: AbortSignal;
}

/**
 * Submits a feedback ticket the user has already read and approved.
 *
 * There is no silent-send path here by design: the report is built, shown, and
 * only then offered for submission, so nothing about an installation leaves
 * the machine without the user having seen exactly what it says.
 *
 * Errors are not swallowed. An organization policy that cannot be fetched
 * fails open because its absence means "nothing extra imposed"; a feedback
 * submission that fails means the report did not arrive, and telling the user
 * it did would be the one dishonest outcome available here.
 */
export async function submitFeedback(
  request: PostRequester,
  submission: FeedbackSubmission,
): Promise<FeedbackTicket> {
  return request('/feedback', feedbackTicketSchema, {
    method: 'POST',
    body: {
      type: submission.type,
      title: submission.title,
      contentMarkdown: submission.contentMarkdown,
    },
    ...(submission.signal === undefined ? {} : { signal: submission.signal }),
  });
}
