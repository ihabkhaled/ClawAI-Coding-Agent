/** A chat session that was closed and can be reopened. */
export interface ClosedSession {
  subject: string;
  threadId: string | undefined;
  closedAt: number;
}
