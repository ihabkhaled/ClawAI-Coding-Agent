import { describe, expect, it } from 'vitest';

import {
  MAX_MEMORY_DEPTH,
  memoryDirectories,
  memoryFileCandidates,
} from '../../src/core/memory-file-discovery';

describe('memoryDirectories', () => {
  it('is the root alone when nothing is open', () => {
    expect(memoryDirectories(undefined)).toEqual(['']);
  });

  it('walks the root down to the file, nearest last', () => {
    expect(memoryDirectories('apps/web/src/app.ts')).toEqual([
      '',
      'apps',
      'apps/web',
      'apps/web/src',
    ]);
  });

  it('is the root alone for a file at the top level', () => {
    expect(memoryDirectories('README.md')).toEqual(['']);
  });

  it('normalizes Windows separators', () => {
    expect(memoryDirectories('apps\\web\\app.ts')).toEqual(['', 'apps', 'apps/web']);
  });

  it('refuses to climb out of the workspace', () => {
    expect(memoryDirectories('../secrets/app.ts')).toEqual(['']);
    expect(memoryDirectories('/etc/passwd')).toEqual(['']);
  });

  it('bounds the depth it will walk', () => {
    const deep = `${Array.from({ length: 40 }, (_, index) => `d${String(index)}`).join('/')}/f.ts`;

    expect(memoryDirectories(deep)).toHaveLength(MAX_MEMORY_DEPTH + 1);
  });
});

describe('memoryFileCandidates', () => {
  it('emits the three root files when nothing is open', () => {
    expect(memoryFileCandidates(undefined)).toEqual([
      '.clawai/rules.md',
      '.clawai/architecture.md',
      '.clawai/memory.md',
    ]);
  });

  it('puts the nearest directory last so it speaks last', () => {
    const candidates = memoryFileCandidates('apps/web/app.ts');

    expect(candidates[0]).toBe('.clawai/rules.md');
    expect(candidates.at(-1)).toBe('apps/web/.clawai/memory.md');
  });

  it('keeps the three files in a fixed order within each directory', () => {
    expect(memoryFileCandidates('apps/app.ts').slice(3)).toEqual([
      'apps/.clawai/rules.md',
      'apps/.clawai/architecture.md',
      'apps/.clawai/memory.md',
    ]);
  });
});
