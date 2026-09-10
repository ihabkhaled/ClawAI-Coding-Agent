import { describe, expect, it } from 'vitest';

import {
  assignThreadToGroup,
  existingGroupNames,
  groupedThreads,
  threadGroupNameSchema,
} from '../../src/core/thread-group';

import type { ChatThread } from '../../src/backend/contracts';

function thread(id: string, overrides: Partial<ChatThread> = {}): ChatThread {
  return { id, title: id, ...overrides };
}

describe('threadGroupNameSchema', () => {
  it('accepts a label a person would type', () => {
    expect(threadGroupNameSchema.parse('  Billing work  ')).toBe('Billing work');
  });

  it('refuses a name that is only whitespace', () => {
    expect(threadGroupNameSchema.safeParse('   ').success).toBe(false);
  });
});

describe('groupedThreads', () => {
  it('leaves everything ungrouped when nothing is filed', () => {
    const result = groupedThreads([thread('a'), thread('b')], {});

    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('files threads into their groups', () => {
    const result = groupedThreads([thread('a'), thread('b')], { a: 'Billing' });

    expect(result.groups).toEqual([{ name: 'Billing', threads: [thread('a')] }]);
    expect(result.ungrouped.map(({ id }) => id)).toEqual(['b']);
  });

  it('orders groups alphabetically so they do not move when someone replies', () => {
    const result = groupedThreads([thread('a'), thread('b')], { a: 'Zebra', b: 'Alpha' });

    expect(result.groups.map(({ name }) => name)).toEqual(['Alpha', 'Zebra']);
  });

  it('never shows an archived conversation, grouped or not', () => {
    const result = groupedThreads([thread('a', { isArchived: true })], { a: 'Billing' });

    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toEqual([]);
  });
});

describe('existingGroupNames', () => {
  it('lists each group once, in order', () => {
    expect(existingGroupNames({ a: 'Zebra', b: 'Alpha', c: 'Zebra' })).toEqual(['Alpha', 'Zebra']);
  });

  it('lists nothing when nothing is filed', () => {
    expect(existingGroupNames({})).toEqual([]);
  });
});

describe('assignThreadToGroup', () => {
  const threads = [thread('a'), thread('b')];

  it('files a thread', () => {
    expect(assignThreadToGroup({}, threads, 'a', 'Billing')).toEqual({ a: 'Billing' });
  });

  it('moves a thread rather than filing it twice', () => {
    expect(assignThreadToGroup({ a: 'Billing' }, threads, 'a', 'Support')).toEqual({
      a: 'Support',
    });
  });

  it('removes the key rather than storing an empty group', () => {
    expect(assignThreadToGroup({ a: 'Billing' }, threads, 'a', undefined)).toEqual({});
  });

  it('drops assignments for conversations that no longer exist', () => {
    expect(assignThreadToGroup({ gone: 'Billing' }, threads, 'a', 'Support')).toEqual({
      a: 'Support',
    });
  });

  it('refuses to file a thread that does not exist', () => {
    expect(assignThreadToGroup({}, threads, 'missing', 'Billing')).toEqual({});
  });

  it('leaves other threads where they were', () => {
    expect(assignThreadToGroup({ b: 'Support' }, threads, 'a', 'Billing')).toEqual({
      a: 'Billing',
      b: 'Support',
    });
  });
});
