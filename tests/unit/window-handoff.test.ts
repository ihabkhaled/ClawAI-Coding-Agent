import { describe, expect, it } from 'vitest';

import { HANDOFF_TTL_MS, claimHandoff, isHandoffFresh } from '../../src/core/window-handoff';

const now = 1_000_000;

describe('isHandoffFresh', () => {
  it('is not fresh when nothing was requested', () => {
    expect(isHandoffFresh(undefined, now)).toBe(false);
  });

  it('is fresh for a request just made', () => {
    expect(isHandoffFresh({ threadId: 't1', requestedAt: now - 500 }, now)).toBe(true);
  });

  it('is fresh at the edge of the window', () => {
    expect(isHandoffFresh({ threadId: 't1', requestedAt: now - HANDOFF_TTL_MS }, now)).toBe(true);
  });

  it('is stale past it, so a crashed handoff cannot hijack a later window', () => {
    expect(isHandoffFresh({ threadId: 't1', requestedAt: now - HANDOFF_TTL_MS - 1 }, now)).toBe(
      false,
    );
  });

  it('refuses a handoff from the future, which is a clock that moved', () => {
    expect(isHandoffFresh({ threadId: 't1', requestedAt: now + 5_000 }, now)).toBe(false);
  });
});

describe('claimHandoff', () => {
  it('yields the thread of a fresh handoff', () => {
    expect(claimHandoff({ threadId: 't1', requestedAt: now }, now)).toBe('t1');
  });

  it('yields nothing for a stale one', () => {
    expect(claimHandoff({ threadId: 't1', requestedAt: 0 }, now)).toBeUndefined();
  });

  it('yields nothing when there is none', () => {
    expect(claimHandoff(undefined, now)).toBeUndefined();
  });
});
