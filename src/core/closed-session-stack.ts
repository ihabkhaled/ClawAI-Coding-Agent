import { DEFAULT_CHAT_SUBJECT } from './chat-session';

import type { ClosedSession } from './closed-session-stack.types';

/** How many closed sessions are remembered before the oldest is forgotten. */
export const CLOSED_SESSION_LIMIT = 10;

/**
 * Records a closed session so it can be reopened, most recent first.
 *
 * An empty chat is not remembered: a session with no thread and the default
 * subject holds nothing to come back to, and remembering it would push a real
 * conversation off the end of the stack. Closing the same thread twice moves
 * its entry to the front rather than storing it twice — the stack answers
 * "what did I just close", and one thread is one answer.
 */
export function rememberClosedSession(
  stack: readonly ClosedSession[],
  entry: ClosedSession,
): ClosedSession[] {
  if (entry.threadId === undefined && entry.subject === DEFAULT_CHAT_SUBJECT) return [...stack];
  const others = stack.filter(
    (closed) => entry.threadId === undefined || closed.threadId !== entry.threadId,
  );
  return [entry, ...others].slice(0, CLOSED_SESSION_LIMIT);
}

/** The session to reopen, and the stack with it removed. */
export function takeClosedSession(
  stack: readonly ClosedSession[],
): { readonly entry: ClosedSession; readonly remaining: ClosedSession[] } | undefined {
  const [entry, ...remaining] = stack;
  return entry === undefined ? undefined : { entry, remaining };
}
