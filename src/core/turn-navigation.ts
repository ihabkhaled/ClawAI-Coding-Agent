/**
 * Which turn to move focus to.
 *
 * Two decisions are encoded, and both are about what a transcript is:
 *
 * From nowhere, moving **back** lands on the last turn and moving **forward**
 * lands on the first. A reader who has not entered the transcript and presses
 * "previous" means the most recent thing said, not the oldest.
 *
 * At either end it **stops rather than wrapping**. Wrapping is fine in a menu
 * of five items; in a conversation it silently teleports the reader from the
 * newest message to the oldest, and a screen-reader user has no peripheral
 * vision to notice.
 */
export function nextTurnIndex(
  current: number | undefined,
  total: number,
  delta: number,
): number | undefined {
  if (total <= 0) return undefined;
  if (current === undefined) return delta < 0 ? total - 1 : 0;
  const target = current + delta;
  if (target < 0) return 0;
  if (target >= total) return total - 1;
  return target;
}

/** The last turn, which is where "jump to latest" goes. */
export function latestTurnIndex(total: number): number | undefined {
  return total <= 0 ? undefined : total - 1;
}
