import { describe, expect, it } from 'vitest';

import {
  MAX_RESERVED_RESPONSE_TOKENS,
  MIN_RESERVED_RESPONSE_TOKENS,
  contextBudget,
  estimateTextTokens,
  reservedResponseTokens,
  truncationRisk,
} from '../../src/core/context-budget';

describe('reservedResponseTokens', () => {
  it('keeps back a share of the window', () => {
    expect(reservedResponseTokens(40_000)).toBe(10_000);
  });

  it('never reserves so little that no answer fits', () => {
    expect(reservedResponseTokens(1_000)).toBe(MIN_RESERVED_RESPONSE_TOKENS);
  });

  it('never reserves more than any reply needs', () => {
    expect(reservedResponseTokens(1_000_000)).toBe(MAX_RESERVED_RESPONSE_TOKENS);
  });
});

describe('contextBudget', () => {
  it('splits a window between the prompt and the answer', () => {
    expect(contextBudget(40_000)).toEqual({
      capacity: 40_000,
      reserved: 10_000,
      availableForPrompt: 30_000,
    });
  });

  it('has no budget when the window is unknown', () => {
    expect(contextBudget(null)).toBeUndefined();
  });

  it('has no budget for a nonsense window rather than a negative one', () => {
    expect(contextBudget(0)).toBeUndefined();
    expect(contextBudget(-5)).toBeUndefined();
  });

  it('never offers the prompt a negative allowance', () => {
    expect(contextBudget(100)?.availableForPrompt).toBe(0);
  });
});

describe('truncationRisk', () => {
  const budget = contextBudget(40_000);

  it('says nothing when there is plenty of room', () => {
    expect(truncationRisk(budget, 1_000)).toBe('none');
  });

  it('warns while the user can still act cheaply', () => {
    expect(truncationRisk(budget, 29_000)).toBe('tight');
  });

  it('says the prompt does not fit', () => {
    expect(truncationRisk(budget, 31_000)).toBe('over');
  });

  it('says nothing it cannot know', () => {
    expect(truncationRisk(undefined, 999_999)).toBe('unknown');
  });
});

describe('estimateTextTokens', () => {
  it('grows with length', () => {
    expect(estimateTextTokens('a'.repeat(400))).toBeGreaterThan(estimateTextTokens('a'.repeat(4)));
  });

  it('costs nothing for nothing', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('never reports a fractional token', () => {
    expect(Number.isInteger(estimateTextTokens('abcde'))).toBe(true);
  });
});
