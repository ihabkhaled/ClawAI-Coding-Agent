import { describe, expect, it } from 'vitest';

import { latestTurnIndex, nextTurnIndex } from '../../src/core/turn-navigation';

describe('nextTurnIndex', () => {
  it('has nowhere to go in an empty transcript', () => {
    expect(nextTurnIndex(undefined, 0, 1)).toBeUndefined();
    expect(nextTurnIndex(undefined, 0, -1)).toBeUndefined();
  });

  it('reads "previous" from nowhere as the most recent turn', () => {
    expect(nextTurnIndex(undefined, 5, -1)).toBe(4);
  });

  it('reads "next" from nowhere as the first turn', () => {
    expect(nextTurnIndex(undefined, 5, 1)).toBe(0);
  });

  it('moves one turn at a time', () => {
    expect(nextTurnIndex(2, 5, 1)).toBe(3);
    expect(nextTurnIndex(2, 5, -1)).toBe(1);
  });

  it('stops at the newest rather than wrapping to the oldest', () => {
    expect(nextTurnIndex(4, 5, 1)).toBe(4);
  });

  it('stops at the oldest rather than wrapping to the newest', () => {
    expect(nextTurnIndex(0, 5, -1)).toBe(0);
  });

  it('lands inside the transcript even when asked to jump far', () => {
    expect(nextTurnIndex(0, 5, 99)).toBe(4);
    expect(nextTurnIndex(4, 5, -99)).toBe(0);
  });

  it('handles a transcript of one', () => {
    expect(nextTurnIndex(0, 1, 1)).toBe(0);
    expect(nextTurnIndex(undefined, 1, -1)).toBe(0);
  });
});

describe('latestTurnIndex', () => {
  it('is the last turn', () => {
    expect(latestTurnIndex(3)).toBe(2);
  });

  it('is nowhere in an empty transcript', () => {
    expect(latestTurnIndex(0)).toBeUndefined();
  });
});
