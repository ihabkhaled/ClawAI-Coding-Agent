import { describe, expect, it, vi } from 'vitest';

import { collectContext } from '../../src/core/context-collector';
import {
  compareContextFreshness,
  contentDigest,
  staleInclusions,
} from '../../src/core/context-freshness';
import { checkContextFreshness } from '../../src/services/context-freshness-service';

import type { ContextInclusion } from '../../src/core/context-collector';

const OPTIONS = { exclude: [], maxBytes: 1_000_000, maxFiles: 100 };

describe('contentDigest', () => {
  it('is the same for the same text and different for different text', () => {
    expect(contentDigest('alpha')).toBe(contentDigest('alpha'));
    expect(contentDigest('alpha')).not.toBe(contentDigest('alphb'));
  });

  it('is short enough to read in a receipt', () => {
    expect(contentDigest('alpha')).toHaveLength(16);
  });
});

describe('collectContext', () => {
  it('records a digest of the range that was collected, not of the whole file', () => {
    const { receipt } = collectContext(
      [{ path: 'src/a.ts', content: 'line two', startLine: 2, endLine: 2 }],
      OPTIONS,
    );

    expect(receipt.included[0]?.digest).toBe(contentDigest('line two'));
  });
});

describe('compareContextFreshness', () => {
  const ranged: ContextInclusion = {
    path: 'src/a.ts',
    startLine: 2,
    endLine: 4,
    digest: contentDigest('as collected'),
  };

  it('says fresh when the range still says what it said', () => {
    const current = new Map([['src/a.ts:2-4', contentDigest('as collected')]]);

    expect(compareContextFreshness([ranged], current)).toEqual([
      { path: 'src/a.ts', startLine: 2, endLine: 4, state: 'fresh' },
    ]);
  });

  it('says changed when the same lines now say something else', () => {
    const current = new Map([['src/a.ts:2-4', contentDigest('edited since')]]);

    expect(compareContextFreshness([ranged], current)[0]?.state).toBe('changed');
  });

  it('separates a range that is gone from one that merely changed', () => {
    expect(compareContextFreshness([ranged], new Map())[0]?.state).toBe('gone');
  });

  it('does not call an old receipt stale for having no digest', () => {
    const legacy: ContextInclusion = { path: 'src/a.ts', startLine: 2, endLine: 4 };

    expect(compareContextFreshness([legacy], new Map())[0]?.state).toBe('fresh');
  });

  it('keys a whole-file inclusion by its path alone', () => {
    const whole: ContextInclusion = { path: 'src/a.ts', digest: contentDigest('all of it') };
    const current = new Map([['src/a.ts', contentDigest('all of it')]]);

    expect(compareContextFreshness([whole], current)[0]).toEqual({
      path: 'src/a.ts',
      state: 'fresh',
    });
  });
});

describe('staleInclusions', () => {
  it('reports only what is no longer true', () => {
    const reports = [
      { path: 'a', state: 'fresh' as const },
      { path: 'b', state: 'changed' as const },
      { path: 'c', state: 'gone' as const },
    ];

    expect(staleInclusions(reports).map((report) => report.path)).toEqual(['b', 'c']);
  });
});

describe('checkContextFreshness', () => {
  it('reads each distinct range once, however many times it appears', async () => {
    const readRange = vi.fn(async () => 'text');
    const included: ContextInclusion[] = [
      { path: 'a.ts', startLine: 1, endLine: 2, digest: contentDigest('text') },
      { path: 'a.ts', startLine: 1, endLine: 2, digest: contentDigest('text') },
      { path: 'a.ts', startLine: 9, endLine: 9, digest: contentDigest('text') },
    ];

    const result = await checkContextFreshness(included, { readRange });

    expect(readRange).toHaveBeenCalledTimes(2);
    expect(result.stale).toEqual([]);
  });

  it('reports a range it could not read as gone', async () => {
    const result = await checkContextFreshness(
      [{ path: 'a.ts', startLine: 1, endLine: 2, digest: contentDigest('text') }],
      { readRange: vi.fn(async () => undefined) },
    );

    expect(result.stale.map((report) => report.state)).toEqual(['gone']);
  });

  it('reports a range whose text moved on as changed', async () => {
    const result = await checkContextFreshness(
      [{ path: 'a.ts', startLine: 1, endLine: 2, digest: contentDigest('before') }],
      { readRange: vi.fn(async () => 'after') },
    );

    expect(result.stale.map((report) => report.state)).toEqual(['changed']);
  });
});
