import { describe, expect, it, vi } from 'vitest';

import { PendingCompactionOffers, usedPercentOf } from '../../src/core/compaction-trigger-offers';
import { MAX_PENDING_COMPACTION_OFFERS } from '../../src/core/compaction-trigger.constants';
import { AutoCompactionService } from '../../src/services/auto-compaction-service';

import type { CompactionOffer } from '../../src/core/compaction-trigger-offers.types';
import type { AutoCompactionMode } from '../../src/core/compaction-trigger.types';

const ID_ONE = '11111111-1111-4111-8111-111111111111';
const ID_TWO = '22222222-2222-4222-8222-222222222222';

function harness(
  options: {
    mode?: AutoCompactionMode;
    delivered?: boolean | 'absent';
    busy?: () => boolean;
    threadExists?: (threadId: string) => boolean;
  } = {},
) {
  const ids = [ID_ONE, ID_TWO];
  const compact = vi.fn(async () => undefined);
  const compactSilently = vi.fn(async (_threadId?: string) => undefined);
  const offered: CompactionOffer[] = [];
  const delivered = options.delivered ?? true;
  const service = new AutoCompactionService({
    mode: () => options.mode ?? 'prompt',
    capacity: () => 10_000,
    busy: options.busy ?? (() => false),
    ...(options.threadExists === undefined ? {} : { threadExists: options.threadExists }),
    compact,
    compactSilently,
    newRequestId: () => ids.shift() ?? ID_TWO,
    ...(delivered === 'absent'
      ? {}
      : {
          offerInline: async (offer: CompactionOffer) => {
            offered.push(offer);
            return delivered;
          },
        }),
  });
  return { compact, compactSilently, offered, service };
}

describe('usedPercentOf', () => {
  it('rounds to a whole percent and caps at 100', () => {
    expect(usedPercentOf(8_000, 7_300)).toBe(91);
    expect(usedPercentOf(8_000, 90_000)).toBe(100);
  });

  it('reports 0 for unusable input rather than NaN', () => {
    expect(usedPercentOf(0, 100)).toBe(0);
    expect(usedPercentOf(100, -5)).toBe(0);
    expect(usedPercentOf(Number.NaN, 5)).toBe(0);
  });
});

describe('PendingCompactionOffers', () => {
  it('hands an offer back once and never again', () => {
    const pending = new PendingCompactionOffers();
    pending.add({ requestId: ID_ONE, threadId: 'a' });

    expect(pending.take(ID_ONE)).toEqual({ requestId: ID_ONE, threadId: 'a' });
    expect(pending.take(ID_ONE)).toBeUndefined();
  });

  it('knows nothing about an id it never issued', () => {
    expect(new PendingCompactionOffers().take(ID_TWO)).toBeUndefined();
  });

  it('lets a newer offer for the same conversation replace the older one', () => {
    const pending = new PendingCompactionOffers();
    pending.add({ requestId: ID_ONE, threadId: 'a' });
    pending.add({ requestId: ID_TWO, threadId: 'a' });

    expect(pending.size).toBe(1);
    expect(pending.take(ID_ONE)).toBeUndefined();
  });

  it('stays bounded, forgetting the oldest first', () => {
    const pending = new PendingCompactionOffers();
    for (let index = 0; index < MAX_PENDING_COMPACTION_OFFERS + 5; index += 1) {
      pending.add({ requestId: `id-${String(index)}`, threadId: `t-${String(index)}` });
    }

    expect(pending.size).toBe(MAX_PENDING_COMPACTION_OFFERS);
    expect(pending.take('id-0')).toBeUndefined();
  });
});

describe('inline compaction offer', () => {
  it('shows the inline card and does not open the modal', async () => {
    const seat = harness();

    expect(await seat.service.observe('thread-1', 9_000)).toBe('offer');
    expect(seat.offered).toHaveLength(1);
    expect(seat.offered[0]).toMatchObject({ requestId: ID_ONE, threadId: 'thread-1' });
    expect(seat.offered[0]?.usedPercent).toBeGreaterThanOrEqual(90);
    expect(seat.offered[0]?.usedPercent).toBeLessThanOrEqual(100);
    expect(seat.compact).not.toHaveBeenCalled();
    expect(seat.compactSilently).not.toHaveBeenCalled();
  });

  it('compacts once when the offer is accepted, and not again on a repeat answer', async () => {
    const seat = harness();
    await seat.service.observe('thread-1', 9_000);

    expect(await seat.service.decide(ID_ONE, true)).toBe('compacted');
    expect(await seat.service.decide(ID_ONE, true)).toBe('ignored');
    expect(seat.compactSilently).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Not now, and stays quiet while the conversation stays full', async () => {
    const seat = harness();
    await seat.service.observe('thread-1', 9_000);

    expect(await seat.service.decide(ID_ONE, false)).toBe('declined');
    expect(await seat.service.observe('thread-1', 9_500)).toBe('none');
    expect(seat.compactSilently).not.toHaveBeenCalled();
    expect(seat.offered).toHaveLength(1);
  });

  it('offers again after usage has dropped and refilled', async () => {
    const seat = harness();
    await seat.service.observe('thread-1', 9_000);
    await seat.service.decide(ID_ONE, false);
    await seat.service.observe('thread-1', 100);

    expect(await seat.service.observe('thread-1', 9_000)).toBe('offer');
    expect(seat.offered).toHaveLength(2);
  });

  it('ignores an answer for an id it never issued', async () => {
    const seat = harness();
    await seat.service.observe('thread-1', 9_000);

    expect(await seat.service.decide(ID_TWO, true)).toBe('ignored');
    expect(seat.compactSilently).not.toHaveBeenCalled();
  });

  it('ignores an answer when no offer was ever raised', async () => {
    const seat = harness();

    expect(await seat.service.decide(ID_ONE, true)).toBe('ignored');
    expect(seat.compactSilently).not.toHaveBeenCalled();
  });

  it('falls back to the modal when no panel received the card', async () => {
    const seat = harness({ delivered: false });

    expect(await seat.service.observe('thread-1', 9_000)).toBe('offer');
    expect(seat.compact).toHaveBeenCalledTimes(1);
    expect(await seat.service.decide(ID_ONE, true)).toBe('ignored');
  });

  it('falls back to the modal when no inline path is wired at all', async () => {
    const seat = harness({ delivered: 'absent' });

    await seat.service.observe('thread-1', 9_000);

    expect(seat.compact).toHaveBeenCalledTimes(1);
  });

  it('leaves automatic mode silent and never shows a card', async () => {
    const seat = harness({ mode: 'automatic' });

    expect(await seat.service.observe('thread-1', 9_000)).toBe('compact');
    expect(seat.compactSilently).toHaveBeenCalledTimes(1);
    expect(seat.offered).toHaveLength(0);
  });

  it('leaves off mode alone', async () => {
    const seat = harness({ mode: 'off' });

    expect(await seat.service.observe('thread-1', 9_999)).toBe('none');
    expect(seat.offered).toHaveLength(0);
    expect(seat.compact).not.toHaveBeenCalled();
  });
});

describe('thread-bound compaction offer', () => {
  it('compacts the thread the offer was made for, not the focused one', async () => {
    const seat = harness();
    await seat.service.observe('thread-a', 9_000);
    await seat.service.observe('thread-b', 9_000);

    expect(await seat.service.decide(ID_ONE, true)).toBe('compacted');
    expect(seat.compactSilently).toHaveBeenCalledTimes(1);
    expect(seat.compactSilently).toHaveBeenCalledWith('thread-a');
  });

  it('keeps the automatic mode on the focused conversation', async () => {
    const seat = harness({ mode: 'automatic' });

    await seat.service.observe('thread-a', 9_000);

    expect(seat.compactSilently).toHaveBeenCalledWith();
  });

  it('refuses an accepted offer while a run is writing, and offers again later', async () => {
    let busy = false;
    const seat = harness({ busy: () => busy });
    await seat.service.observe('thread-a', 9_000);
    busy = true;

    expect(await seat.service.decide(ID_ONE, true)).toBe('refused');
    expect(seat.compactSilently).not.toHaveBeenCalled();
    expect(await seat.service.decide(ID_ONE, true)).toBe('ignored');
    busy = false;
    expect(await seat.service.observe('thread-a', 9_000)).toBe('offer');
  });

  it('refuses an accepted offer for a conversation that no longer exists', async () => {
    const seat = harness({ threadExists: () => false });
    await seat.service.observe('thread-a', 9_000);

    expect(await seat.service.decide(ID_ONE, true)).toBe('refused');
    expect(seat.compactSilently).not.toHaveBeenCalled();
  });

  it('lifts the mark of an abandoned offer so a later crossing offers again', async () => {
    const seat = harness();
    await seat.service.observe('thread-a', 9_000);

    seat.service.abandon(ID_ONE);

    expect(await seat.service.decide(ID_ONE, true)).toBe('ignored');
    expect(await seat.service.observe('thread-a', 9_000)).toBe('offer');
    expect(seat.offered).toHaveLength(2);
  });

  it('ignores abandoning an id it never issued', () => {
    const seat = harness();

    expect(() => {
      seat.service.abandon(ID_TWO);
    }).not.toThrow();
  });

  it('accepts the answer even if it arrives before the post resolves', async () => {
    const compactSilently = vi.fn(async (_threadId?: string) => undefined);
    const service: AutoCompactionService = new AutoCompactionService({
      mode: () => 'prompt',
      capacity: () => 10_000,
      busy: () => false,
      compact: async () => undefined,
      compactSilently,
      newRequestId: () => ID_ONE,
      offerInline: async () => {
        await service.decide(ID_ONE, true);
        return true;
      },
    });

    await service.observe('thread-a', 9_000);

    expect(compactSilently).toHaveBeenCalledWith('thread-a');
  });
});
