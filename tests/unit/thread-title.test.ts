import { describe, expect, it } from 'vitest';

import {
  MAX_THREAD_TITLE_LENGTH,
  isThreadRename,
  normalizeThreadTitle,
} from '../../src/core/thread-title';

describe('normalizeThreadTitle', () => {
  it('keeps a plain title', () => {
    expect(normalizeThreadTitle('Parser rewrite')).toBe('Parser rewrite');
  });

  it('collapses whitespace so a title stays one line in a list', () => {
    expect(normalizeThreadTitle('  Parser\n\t rewrite  ')).toBe('Parser rewrite');
  });

  it('treats a blank title as no title rather than an empty name', () => {
    expect(normalizeThreadTitle('   ')).toBeUndefined();
    expect(normalizeThreadTitle('')).toBeUndefined();
  });

  it('trims to what the contract accepts', () => {
    expect(normalizeThreadTitle('x'.repeat(400))).toHaveLength(MAX_THREAD_TITLE_LENGTH);
  });
});

describe('isThreadRename', () => {
  it('is a rename when the name changes', () => {
    expect(isThreadRename('Old', 'New')).toBe(true);
  });

  it('is not a rename when the name is the same', () => {
    expect(isThreadRename('Same', 'Same')).toBe(false);
  });

  it('is a rename when the thread had no name at all', () => {
    expect(isThreadRename(null, 'New')).toBe(true);
    expect(isThreadRename(undefined, 'New')).toBe(true);
  });
});
