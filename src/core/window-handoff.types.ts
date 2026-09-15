/** A request to open one conversation in the next window that starts. */
export interface WindowHandoff {
  threadId: string;
  requestedAt: number;
}
