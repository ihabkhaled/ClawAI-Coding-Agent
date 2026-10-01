/** The `requestId` field of a message, or nothing when the message is not bound to a request. */
export function requestScope(requestId: string | undefined): { requestId?: string } {
  return requestId === undefined ? {} : { requestId };
}
