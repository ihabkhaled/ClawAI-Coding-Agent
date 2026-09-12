import type { ChatThread } from '../backend/contracts';

/**
 * The threads a history list should show.
 *
 * Archived threads are hidden rather than dimmed: archiving is the user saying
 * they are done with a conversation, and a list that still shows it has not
 * done what they asked. They stay reachable through the archived browser,
 * which is what makes archiving safe to do.
 *
 * Pinned threads come first, and within each group the list keeps the order
 * the backend sent — that order is recency, and re-sorting here would silently
 * disagree with whatever the server was asked for.
 */
export function visibleThreads(threads: readonly ChatThread[]): ChatThread[] {
  const shown = threads.filter((thread) => thread.isArchived !== true);
  return [
    ...shown.filter((thread) => thread.isPinned === true),
    ...shown.filter((thread) => thread.isPinned !== true),
  ];
}

/** The threads the archived browser should offer, most recent first. */
export function archivedThreads(threads: readonly ChatThread[]): ChatThread[] {
  return threads.filter((thread) => thread.isArchived === true);
}
