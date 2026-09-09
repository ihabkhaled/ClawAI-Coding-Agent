import { describe, expect, it } from 'vitest';

import {
  findFileRangeReferences,
  parseFileRangeReference,
} from '../../src/core/file-range-reference';

describe('parseFileRangeReference', () => {
  it('parses a single-line reference', () => {
    expect(parseFileRangeReference('src/foo.ts:10')).toEqual({
      path: 'src/foo.ts',
      startLine: 10,
      endLine: 10,
    });
  });

  it('parses a range reference', () => {
    expect(parseFileRangeReference('src/foo.ts:10-25')).toEqual({
      path: 'src/foo.ts',
      startLine: 10,
      endLine: 25,
    });
  });

  it('parses a nested path', () => {
    expect(parseFileRangeReference('apps/web/src/index.ts:3-3')).toEqual({
      path: 'apps/web/src/index.ts',
      startLine: 3,
      endLine: 3,
    });
  });

  it.each([
    'src/foo.ts',
    'src/foo.ts:',
    'src/foo.ts:0',
    'src/foo.ts:25-10',
    'src/foo.ts:-5',
    'src/foo.ts:5-',
    ':10',
    'src/foo.ts:1.5',
    'https://example.com:8080',
    'http://example.com:8080-9090',
  ])('returns undefined for %s', (token) => {
    expect(parseFileRangeReference(token)).toBeUndefined();
  });
});

describe('findFileRangeReferences', () => {
  it('returns an empty list when the prompt has no references', () => {
    expect(findFileRangeReferences('Please review my changes.')).toEqual([]);
  });

  it('finds one reference inside a sentence', () => {
    expect(findFileRangeReferences('What does src/foo.ts:10-25 do?')).toEqual([
      { path: 'src/foo.ts', startLine: 10, endLine: 25 },
    ]);
  });

  it('finds multiple distinct references in order', () => {
    expect(findFileRangeReferences('Compare src/a.ts:1-5 against src/b.ts:8')).toEqual([
      { path: 'src/a.ts', startLine: 1, endLine: 5 },
      { path: 'src/b.ts', startLine: 8, endLine: 8 },
    ]);
  });

  it('deduplicates an identical reference repeated in the prompt', () => {
    expect(findFileRangeReferences('src/foo.ts:10-25 and again src/foo.ts:10-25')).toEqual([
      { path: 'src/foo.ts', startLine: 10, endLine: 25 },
    ]);
  });

  it('keeps two different ranges of the same file distinct', () => {
    expect(findFileRangeReferences('src/foo.ts:1-5 then src/foo.ts:10-15')).toEqual([
      { path: 'src/foo.ts', startLine: 1, endLine: 5 },
      { path: 'src/foo.ts', startLine: 10, endLine: 15 },
    ]);
  });

  it('ignores a URL with a port number', () => {
    expect(findFileRangeReferences('See https://example.com:8080 for details.')).toEqual([]);
  });

  it('caps the number of references it returns', () => {
    const many = Array.from({ length: 30 }, (_, index) => `src/f${String(index)}.ts:1`).join(' ');
    expect(findFileRangeReferences(many).length).toBeLessThanOrEqual(20);
  });
});
