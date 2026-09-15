import { describe, expect, it } from 'vitest';

import { archivedThreads, visibleThreads } from '../../src/core/thread-list';

import type { ChatThread } from '../../src/backend/contracts';

function thread(id: string, overrides: Partial<ChatThread> = {}): ChatThread {
  return { id, title: id, ...overrides };
}

describe('visibleThreads', () => {
  it('hides archived conversations rather than dimming them', () => {
    const threads = [thread('a'), thread('b', { isArchived: true })];

    expect(visibleThreads(threads).map(({ id }) => id)).toEqual(['a']);
  });

  it('puts pinned conversations first', () => {
    const threads = [thread('a'), thread('b', { isPinned: true })];

    expect(visibleThreads(threads).map(({ id }) => id)).toEqual(['b', 'a']);
  });

  it('keeps the order the backend sent within each group', () => {
    const threads = [thread('a'), thread('b'), thread('c')];

    expect(visibleThreads(threads).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('shows a thread whose flags the backend never sent', () => {
    expect(visibleThreads([thread('a')])).toHaveLength(1);
  });
});

describe('archivedThreads', () => {
  it('offers only what was archived', () => {
    const threads = [thread('a'), thread('b', { isArchived: true })];

    expect(archivedThreads(threads).map(({ id }) => id)).toEqual(['b']);
  });

  it('is empty when nothing is archived', () => {
    expect(archivedThreads([thread('a')])).toEqual([]);
  });
});
