import { describe, expect, it } from 'vitest';

import {
  matchesRunJournalSearch,
  rankRunJournals,
  runJournalSearchSchema,
  type RunJournalSummary,
} from '../../src/core/run-journal-search';

function summary(overrides: Partial<RunJournalSummary> = {}): RunJournalSummary {
  return {
    runId: 'runtime:one',
    goal: 'Migrate the billing schema',
    labels: ['billing', 'migration'],
    pinned: false,
    lifecycle: 'completed',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

const empty = runJournalSearchSchema.parse({});

describe('matchesRunJournalSearch', () => {
  it('matches everything when nothing is asked', () => {
    expect(matchesRunJournalSearch(summary(), empty)).toBe(true);
  });

  it('still matches the goal by substring', () => {
    expect(matchesRunJournalSearch(summary(), { ...empty, query: 'billing schema' })).toBe(true);
    expect(matchesRunJournalSearch(summary(), { ...empty, query: 'invoice' })).toBe(false);
  });

  it('matches a label through the text query', () => {
    expect(matchesRunJournalSearch(summary(), { ...empty, query: 'migration' })).toBe(true);
  });

  it('ignores case in the query', () => {
    expect(matchesRunJournalSearch(summary(), { ...empty, query: 'MIGRATE' })).toBe(true);
  });

  it('narrows by lifecycle', () => {
    expect(matchesRunJournalSearch(summary(), { ...empty, lifecycle: 'completed' })).toBe(true);
    expect(matchesRunJournalSearch(summary(), { ...empty, lifecycle: 'abandoned' })).toBe(false);
  });

  it('narrows by exact label rather than substring', () => {
    expect(matchesRunJournalSearch(summary(), { ...empty, label: 'billing' })).toBe(true);
    expect(matchesRunJournalSearch(summary(), { ...empty, label: 'bill' })).toBe(false);
  });

  it('narrows by pinned in both directions', () => {
    expect(matchesRunJournalSearch(summary({ pinned: true }), { ...empty, pinned: true })).toBe(
      true,
    );
    expect(matchesRunJournalSearch(summary({ pinned: true }), { ...empty, pinned: false })).toBe(
      false,
    );
  });

  it('narrows by an updated-since bound, inclusive', () => {
    const search = { ...empty, updatedSince: '2026-08-20T12:00:00.000Z' };

    expect(matchesRunJournalSearch(summary(), search)).toBe(true);
    expect(
      matchesRunJournalSearch(summary({ updatedAt: '2026-08-19T23:59:59.000Z' }), search),
    ).toBe(false);
  });

  it('requires every facet to hold at once', () => {
    const search = { ...empty, query: 'billing', lifecycle: 'abandoned' as const };

    expect(matchesRunJournalSearch(summary(), search)).toBe(false);
  });
});

describe('rankRunJournals', () => {
  it('puts pinned runs first, then the most recently updated', () => {
    const ranked = rankRunJournals([
      summary({ runId: 'old', updatedAt: '2026-08-01T00:00:00.000Z' }),
      summary({ runId: 'new', updatedAt: '2026-08-30T00:00:00.000Z' }),
      summary({ runId: 'pinned', pinned: true, updatedAt: '2026-07-01T00:00:00.000Z' }),
    ]);

    expect(ranked.map((entry) => entry.runId)).toEqual(['pinned', 'new', 'old']);
  });

  it('does not mutate the input', () => {
    const input = [summary({ runId: 'a' }), summary({ runId: 'b', pinned: true })];

    rankRunJournals(input);

    expect(input.map((entry) => entry.runId)).toEqual(['a', 'b']);
  });
});

describe('runJournalSearchSchema', () => {
  it('defaults the query to an empty string', () => {
    expect(runJournalSearchSchema.parse({}).query).toBe('');
  });

  it('rejects a lifecycle the journal does not use', () => {
    expect(runJournalSearchSchema.safeParse({ lifecycle: 'finished' }).success).toBe(false);
  });

  it('rejects an updatedSince that is not a timestamp', () => {
    expect(runJournalSearchSchema.safeParse({ updatedSince: 'last week' }).success).toBe(false);
  });
});
