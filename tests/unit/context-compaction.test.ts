import { describe, expect, it } from 'vitest';

import { contextBudget } from '../../src/core/context-budget';
import {
  COMPACTION_INSTRUCTION,
  compactionSeed,
  shouldCompact,
} from '../../src/core/context-compaction';

const budget = contextBudget(40_000);

describe('shouldCompact', () => {
  it('leaves a conversation with room alone', () => {
    expect(shouldCompact(budget, 1_000)).toEqual({ compact: false, reason: 'room-remains' });
  });

  it('offers compaction once the allowance is nearly spent', () => {
    expect(shouldCompact(budget, 29_000)).toEqual({ compact: true, reason: 'nearly-full' });
  });

  it('never compacts on a guess about an unknown window', () => {
    expect(shouldCompact(undefined, 999_999)).toEqual({
      compact: false,
      reason: 'unknown-capacity',
    });
  });

  it('never divides by an allowance of nothing', () => {
    expect(shouldCompact({ capacity: 10, reserved: 10, availableForPrompt: 0 }, 5)).toEqual({
      compact: false,
      reason: 'unknown-capacity',
    });
  });
});

describe('COMPACTION_INSTRUCTION', () => {
  it('asks for what a continuation needs rather than a readable retelling', () => {
    expect(COMPACTION_INSTRUCTION).toContain('decisions');
    expect(COMPACTION_INSTRUCTION).toContain('outstanding');
    expect(COMPACTION_INSTRUCTION).toContain('open questions');
    expect(COMPACTION_INSTRUCTION).toContain('paths');
  });
});

describe('compactionSeed', () => {
  it('labels the summary as a summary rather than as a request', () => {
    const seed = compactionSeed('We chose Zod.');

    expect(seed).toContain('continues an earlier one');
    expect(seed).toContain('We chose Zod.');
  });

  it('tells the model to ask rather than assume', () => {
    expect(compactionSeed('anything')).toContain('Ask if anything above is unclear');
  });

  it('trims a summary that arrived with padding', () => {
    expect(compactionSeed('  padded  ')).toContain('\npadded\n');
  });
});
