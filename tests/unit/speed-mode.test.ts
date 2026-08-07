import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SPEED_MODE,
  SPEED_MODES,
  SPEED_MODE_CONTRACTS,
  forEachPrefetched,
  normalizeSpeedMode,
  readConcurrency,
} from '../../src/core/speed-mode';

describe('speed modes', () => {
  it('gives every mode a strictly higher read concurrency than the one below it', () => {
    const ladder = SPEED_MODES.map((mode) => readConcurrency(mode));
    expect(ladder).toEqual([1, 4, 8]);
    ladder.reduce((previous, value) => {
      expect(value).toBeGreaterThan(previous);
      return value;
    });
  });

  it('keeps the baseline at one read in flight so 1X is the previous behaviour', () => {
    expect(DEFAULT_SPEED_MODE).toBe('1X');
    expect(readConcurrency('1X')).toBe(1);
  });

  it('documents a distinct contract for every mode', () => {
    for (const mode of SPEED_MODES) {
      expect(SPEED_MODE_CONTRACTS[mode].length, mode).toBeGreaterThan(40);
    }
    expect(new Set(Object.values(SPEED_MODE_CONTRACTS)).size).toBe(SPEED_MODES.length);
  });

  it('falls back to the slow baseline on an unusable setting', () => {
    for (const value of [undefined, null, '', '3X', 2, {}]) {
      expect(normalizeSpeedMode(value)).toBe('1X');
    }
    for (const mode of SPEED_MODES) {
      expect(normalizeSpeedMode(mode)).toBe(mode);
    }
  });
});

describe('forEachPrefetched', () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it('accounts every item exactly once, in order', async () => {
    const seen: number[] = [];
    await forEachPrefetched(
      items,
      4,
      async (item) => item * 2,
      (_item, fetched, index) => {
        expect(fetched.ok).toBe(true);
        seen.push(index);
        return 'continue';
      },
    );
    expect(seen).toEqual(items);
  });

  it('actually overlaps the fetches it is allowed to overlap', async () => {
    let inFlight = 0;
    let peak = 0;
    await forEachPrefetched(
      items,
      4,
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item;
      },
      () => 'continue',
    );
    expect(peak).toBe(4);
  });

  it('issues one fetch at a time at the baseline, which is what makes 1X unchanged', async () => {
    let inFlight = 0;
    let peak = 0;
    await forEachPrefetched(
      items,
      readConcurrency('1X'),
      async (item) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return item;
      },
      () => 'continue',
    );
    expect(peak).toBe(1);
  });

  it('stops accounting immediately and never overshoots past the batch', async () => {
    const prefetch = vi.fn(async (item: number) => item);
    const accounted: number[] = [];
    await forEachPrefetched(items, 4, prefetch, (_item, _fetched, index) => {
      accounted.push(index);
      return index === 1 ? 'stop' : 'continue';
    });
    expect(accounted).toEqual([0, 1]);
    // Overshoot is bounded by the batch: 4 fetched, 2 accounted. Never the
    // whole list.
    expect(prefetch).toHaveBeenCalledTimes(4);
  });

  it('fetches nothing beyond the stopping point at the baseline', async () => {
    const prefetch = vi.fn(async (item: number) => item);
    await forEachPrefetched(items, 1, prefetch, (_item, _fetched, index) =>
      index === 2 ? 'stop' : 'continue',
    );
    expect(prefetch).toHaveBeenCalledTimes(3);
  });

  it('hands a failure to the item that owns it rather than rejecting', async () => {
    const failure = new Error('outside the workspace');
    const outcomes: boolean[] = [];
    await forEachPrefetched(
      items.slice(0, 4),
      4,
      async (item) => {
        if (item === 2) throw failure;
        return item;
      },
      (_item, fetched) => {
        outcomes.push(fetched.ok);
        return 'continue';
      },
    );
    expect(outcomes).toEqual([true, true, false, true]);
  });

  it('never surfaces a failure for an item the accounting loop never reached', async () => {
    // A speculatively prefetched neighbour must not raise an error the
    // one-at-a-time path would never have produced.
    const seen: boolean[] = [];
    await forEachPrefetched(
      items.slice(0, 4),
      4,
      async (item) => {
        if (item === 3) throw new Error('never reached');
        return item;
      },
      (_item, fetched, index) => {
        seen.push(fetched.ok);
        return index === 1 ? 'stop' : 'continue';
      },
    );
    expect(seen).toEqual([true, true]);
  });

  it('rejects a nonsensical concurrency instead of silently serializing', async () => {
    for (const concurrency of [0, -1, 1.5, Number.NaN]) {
      await expect(
        forEachPrefetched(
          [1],
          concurrency,
          async (item) => item,
          () => 'continue',
        ),
      ).rejects.toThrow(/positive integer/iu);
    }
  });
});
