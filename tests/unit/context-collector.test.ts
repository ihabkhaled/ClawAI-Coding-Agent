import { describe, expect, it } from 'vitest';

import {
  collectContext,
  mergeCollectedContext,
  type CollectedContext,
  type ContextCandidate,
} from '../../src/core/context-collector';

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

  it('always excludes repository metadata and common credential files with no user excludes', () => {
    const sensitivePaths = [
      '.git/config',
      '.ssh/id_rsa',
      '.npmrc',
      '.pypirc',
      '.netrc',
      'config/password.txt',
      'config/private-key.pem',
      'config/access_token.json',
      'config/token.txt',
    ];
    const result = collectContext(
      [
        ...sensitivePaths.map((path) => ({ path, content: 'must-not-leave-workspace' })),
        { path: 'src/tokenizer.ts', content: 'export const tokenizer = true;\n' },
      ],
      {
        exclude: [],
        maxBytes: 10_000,
        maxFiles: 20,
      },
    );

    expect(result.files).toEqual([
      { path: 'src/tokenizer.ts', content: 'export const tokenizer = true;\n' },
    ]);
    expect(result.receipt.excluded).toEqual(
      sensitivePaths.map((path) => ({ path, reason: 'sensitive' })),
    );
  });
});

describe('mergeCollectedContext', () => {
  const base: CollectedContext = {
    files: [{ path: 'src/index.ts', content: 'whole file\n' }],
    receipt: {
      included: [{ path: 'src/index.ts' }],
      excluded: [{ path: '.env', reason: 'sensitive' }],
      totalBytes: 11,
      truncated: false,
    },
  };

  it('appends a reference to a different file', () => {
    const additional: CollectedContext = {
      files: [{ path: 'src/other.ts', content: 'ranged\n', startLine: 3, endLine: 3 }],
      receipt: {
        included: [{ path: 'src/other.ts', startLine: 3, endLine: 3 }],
        excluded: [],
        totalBytes: 7,
        truncated: false,
      },
    };

    const merged = mergeCollectedContext(base, additional);

    expect(merged.files.map((file) => file.path)).toEqual(['src/index.ts', 'src/other.ts']);
    expect(merged.receipt.included).toEqual([
      { path: 'src/index.ts' },
      { path: 'src/other.ts', startLine: 3, endLine: 3 },
    ]);
    expect(merged.receipt.excluded).toEqual([{ path: '.env', reason: 'sensitive' }]);
    expect(merged.receipt.totalBytes).toBe(18);
    expect(merged.receipt.truncated).toBe(false);
  });

  it('skips a reference to a path the base already includes', () => {
    const additional: CollectedContext = {
      files: [{ path: 'src/index.ts', content: 'a range of it', startLine: 1, endLine: 1 }],
      receipt: {
        included: [{ path: 'src/index.ts', startLine: 1, endLine: 1 }],
        excluded: [],
        totalBytes: 13,
        truncated: false,
      },
    };

    const merged = mergeCollectedContext(base, additional);

    expect(merged.files).toEqual(base.files);
    expect(merged.receipt.included).toEqual(base.receipt.included);
    expect(merged.receipt.totalBytes).toBe(base.receipt.totalBytes);
  });

  it('carries truncation forward from either side', () => {
    const truncatedAdditional: CollectedContext = {
      files: [],
      receipt: { included: [], excluded: [], totalBytes: 0, truncated: true },
    };

    expect(mergeCollectedContext(base, truncatedAdditional).receipt.truncated).toBe(true);
  });
});
