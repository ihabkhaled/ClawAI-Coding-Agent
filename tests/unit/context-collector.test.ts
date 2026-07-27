import { describe, expect, it } from 'vitest';

import { collectContext, type ContextCandidate } from '../../src/core/context-collector';

const candidates: ContextCandidate[] = [
  {
    path: 'src/index.ts',
    content: 'export const answer = 42;\n',
  },
  {
    path: '.env.local',
    content: 'API_TOKEN=secret',
  },
  {
    path: 'src/generated.ts',
    content: 'x'.repeat(80),
  },
  {
    path: 'README.md',
    content: '# Hello\n',
  },
];

describe('context collection', () => {
  it('applies deny patterns before bounded collection and returns an explainable receipt', () => {
    const result = collectContext(candidates, {
      exclude: ['**/.env*', '**/generated.*'],
      maxBytes: 200,
      maxFiles: 10,
    });

    expect(result.files.map((file) => file.path)).toEqual(['src/index.ts', 'README.md']);
    expect(result.receipt.excluded).toEqual([
      {
        path: '.env.local',
        reason: 'sensitive',
      },
      {
        path: 'src/generated.ts',
        reason: 'excluded',
      },
    ]);
    expect(result.receipt.totalBytes).toBeGreaterThan(0);
  });

  it('stops at byte and file limits without truncating a UTF-8 file invisibly', () => {
    const result = collectContext(candidates, {
      exclude: [],
      maxBytes: 30,
      maxFiles: 1,
    });

    expect(result.files).toHaveLength(1);
    expect(result.receipt.excluded.some((entry) => entry.reason === 'limit')).toBe(true);
    expect(result.receipt.truncated).toBe(true);
  });

  it('normalizes Windows paths and excludes binary content and single-segment globs', () => {
    const result = collectContext(
      [
        { path: 'src\\safe.ts', content: 'safe' },
        { path: 'src\\binary.ts', content: 'prefix\0suffix' },
        { path: 'src\\generated-a.ts', content: 'generated' },
      ],
      {
        exclude: ['src/generated-?.ts'],
        maxBytes: 1_000,
        maxFiles: 10,
      },
    );

    expect(result.files).toEqual([{ path: 'src/safe.ts', content: 'safe' }]);
    expect(result.receipt.excluded).toEqual(
      expect.arrayContaining([
        { path: 'src/binary.ts', reason: 'binary' },
        { path: 'src/generated-a.ts', reason: 'excluded' },
      ]),
    );
  });
});
