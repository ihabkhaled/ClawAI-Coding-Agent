import { z } from 'zod';

/**
 * How much independent, non-mutating work may happen at once.
 *
 * Speed is not permission to skip correctness, so this deliberately does not
 * touch approvals, tests, writes, or which files end up in context. What it
 * changes is how many workspace *metadata* lookups — the containment check and
 * the stat — are in flight while the extension builds a context envelope.
 * Those are independent of each other, cost nothing but a syscall, and used to
 * run strictly one at a time behind every candidate file.
 *
 * Reading a file's bytes is deliberately left serial and conditional on the
 * running byte total. Parallelising that would be faster and would pull every
 * near-limit candidate into memory only to discard it, trading a bounded
 * memory guarantee for latency.
 *
 * `1X` is the default and means one lookup at a time, which is exactly what
 * the extension did before speed modes existed.
 */
export const SPEED_MODES = ['1X', '1.5X', '2X'] as const;

export type SpeedMode = (typeof SPEED_MODES)[number];

export const DEFAULT_SPEED_MODE: SpeedMode = '1X';

export const speedModeSchema = z.enum(SPEED_MODES);

/**
 * What each mode is allowed to do, in the words a reviewer needs to check that
 * nothing unsafe was bought with the latency. Pack §14 requires speed modes to
 * be orchestration strategies rather than a badge.
 */
export const SPEED_MODE_CONTRACTS: Readonly<Record<SpeedMode, string>> = {
  '1X': 'Correctness baseline. One workspace metadata lookup in flight at a time, exactly as the extension behaved before speed modes existed.',
  '1.5X':
    'Safe acceleration. Containment checks and stats are issued four at a time; the file set, the byte budget and the inclusion order are unchanged.',
  '2X': 'Aggressive safe acceleration. Containment checks and stats are issued eight at a time. Byte reads stay serial and conditional, and approvals, writes and commands are untouched.',
};

const readConcurrencies: Readonly<Record<SpeedMode, number>> = {
  '1X': 1,
  '1.5X': 4,
  '2X': 8,
};

/**
 * An unknown or absent value resolves to the baseline rather than throwing. A
 * settings file is user-editable, and the safe direction for a bad speed value
 * is the slow one.
 */
export function normalizeSpeedMode(value: unknown): SpeedMode {
  return speedModeSchema.catch(DEFAULT_SPEED_MODE).parse(value);
}

/** How many independent metadata lookups this mode may have in flight. */
export function readConcurrency(mode: SpeedMode): number {
  return readConcurrencies[mode];
}

export type PrefetchDecision = 'continue' | 'stop';

/**
 * Walks an ordered list, prefetching in bounded parallel batches while keeping
 * the decision that consumes each item strictly sequential and in order.
 *
 * This shape exists because the workspace read loop is order-dependent: each
 * file's inclusion depends on how many bytes and files the ones before it
 * already consumed. Reading them in parallel and then deciding would be fast
 * and wrong — it would change which files land in context. Reading in
 * parallel and *deciding* in order is fast and identical.
 *
 * `prefetch` never rejects into the caller; a failure is handed to `account`
 * for the item it belongs to, so an item the accounting loop never reaches
 * cannot surface an error it would not have produced sequentially.
 *
 * `account` may be async on purpose. Work that must stay conditional — reading
 * a file's bytes only once the running total says it fits — belongs there, not
 * in the prefetch, or the parallelism would buy latency with memory.
 *
 * Overshoot is bounded by `concurrency - 1`: at most that many items past the
 * stopping point are fetched, and at `1X` the overshoot is zero, which is what
 * makes the baseline byte-identical to the previous behaviour.
 */
export async function forEachPrefetched<TItem, TFetched>(
  items: readonly TItem[],
  concurrency: number,
  prefetch: (item: TItem) => Promise<TFetched>,
  account: (
    item: TItem,
    fetched: { ok: true; value: TFetched } | { ok: false; error: unknown },
    index: number,
  ) => Promise<PrefetchDecision> | PrefetchDecision,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Prefetch concurrency must be a positive integer');
  }
  for (let start = 0; start < items.length; start += concurrency) {
    const batch = items.slice(start, start + concurrency);
    const fetched = await Promise.all(
      batch.map(async (item) => {
        try {
          return { ok: true as const, value: await prefetch(item) };
        } catch (error: unknown) {
          return { ok: false as const, error };
        }
      }),
    );
    for (const [offset, item] of batch.entries()) {
      const result = fetched[offset];
      if (result === undefined) continue;
      if ((await account(item, result, start + offset)) === 'stop') return;
    }
  }
}
