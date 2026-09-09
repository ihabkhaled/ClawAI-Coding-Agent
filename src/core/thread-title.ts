/** The longest title the thread contract accepts. */
export const MAX_THREAD_TITLE_LENGTH = 255;

/**
 * A title as it should be stored, or nothing if the user gave none.
 *
 * Whitespace is collapsed and the result trimmed: a title is one line in a
 * list, and a title that is mostly spaces looks like a bug in the list rather
 * than a name someone chose. An empty result is `undefined` rather than an
 * empty string, because clearing a title and never setting one are the same
 * thing and should not be two states.
 */
export function normalizeThreadTitle(raw: string): string | undefined {
  const collapsed = raw.replaceAll(/\s+/gu, ' ').trim();
  return collapsed.length === 0 ? undefined : collapsed.slice(0, MAX_THREAD_TITLE_LENGTH);
}

/**
 * Whether renaming to this title is worth a request.
 *
 * A rename to the same name is not a rename. Sending it anyway would bump the
 * thread's `updatedAt` and move it to the top of a list sorted by recency,
 * which is a visible change the user did not ask for.
 */
export function isThreadRename(current: string | null | undefined, next: string): boolean {
  return (current ?? '') !== next;
}
