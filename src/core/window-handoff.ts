import type { WindowHandoff } from './window-handoff.types';

/**
 * How long a pending handoff stays valid.
 *
 * Short on purpose. A handoff is written, a window opens, and the new window
 * claims it — that takes seconds. Anything older is left over from a window
 * that never opened, a crash, or a cancelled folder prompt, and honouring it
 * would mean a conversation the user asked for minutes ago hijacking the next
 * window they open for something else entirely.
 */
export const HANDOFF_TTL_MS = 60_000;

/** Whether a stored handoff is recent enough to act on. */
export function isHandoffFresh(handoff: WindowHandoff | undefined, now: number): boolean {
  if (handoff === undefined) return false;
  const age = now - handoff.requestedAt;
  // A handoff from the future is a clock that moved, not a fresh request.
  return age >= 0 && age <= HANDOFF_TTL_MS;
}

/**
 * The handoff a newly opened window should act on, and nothing afterwards.
 *
 * Returns the thread once and expects the caller to clear the record. A
 * handoff that survived being read would reopen the same conversation in every
 * window opened after it.
 */
export function claimHandoff(handoff: WindowHandoff | undefined, now: number): string | undefined {
  return isHandoffFresh(handoff, now) ? handoff?.threadId : undefined;
}
