import { z } from 'zod';

import type { DurableRunJournal } from './durable-run-journal';

/** What a search result shows without decrypting anything further. */
export type RunJournalSummary = Pick<
  DurableRunJournal,
  'runId' | 'goal' | 'labels' | 'pinned' | 'lifecycle' | 'updatedAt'
>;

export const runJournalSearchSchema = z
  .object({
    query: z.string().trim().max(500).default(''),
    lifecycle: z
      .enum([
        'resumable',
        'needs-revalidation',
        'blocked-by-drift',
        'completed',
        'cancelled',
        'abandoned',
      ])
      .optional(),
    label: z.string().trim().min(1).max(100).optional(),
    pinned: z.boolean().optional(),
    /** ISO timestamp; only runs updated at or after it match. */
    updatedSince: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export type RunJournalSearch = z.infer<typeof runJournalSearchSchema>;

/**
 * Every facet is a narrowing, and an empty search matches everything.
 *
 * The text query stays a substring match over the goal and labels, which is
 * what it always was — the gap this closes is that it was the *only* thing a
 * search could say. "Which runs did I abandon this week" was unanswerable
 * with a query string, no matter how it was worded.
 */
export function matchesRunJournalSearch(
  summary: RunJournalSummary,
  search: RunJournalSearch,
): boolean {
  if (search.lifecycle !== undefined && summary.lifecycle !== search.lifecycle) return false;
  if (search.pinned !== undefined && summary.pinned !== search.pinned) return false;
  if (
    search.label !== undefined &&
    !summary.labels.some((label) => label.toLocaleLowerCase() === search.label?.toLocaleLowerCase())
  ) {
    return false;
  }
  if (search.updatedSince !== undefined && summary.updatedAt < search.updatedSince) return false;
  const query = search.query.toLocaleLowerCase();
  if (query.length === 0) return true;
  return `${summary.goal} ${summary.labels.join(' ')}`.toLocaleLowerCase().includes(query);
}

/**
 * Pinned first, then most recently updated.
 *
 * Pinning is the user saying "this one matters", and a search that buried a
 * pinned run under fresher noise would be ignoring the only ranking signal
 * anyone actually gave it.
 */
export function rankRunJournals(summaries: readonly RunJournalSummary[]): RunJournalSummary[] {
  return [...summaries].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt),
  );
}
