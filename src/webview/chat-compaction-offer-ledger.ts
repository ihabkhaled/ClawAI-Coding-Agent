import { MAX_PENDING_COMPACTION_OFFERS } from '../core/compaction-trigger.constants';

import type { LedgerEntry } from './chat-compaction-offer-ledger.types';
import type { CompactionOfferMessage } from './chat-compaction-offer.types';

/**
 * The offers this host has posted to a panel and not yet seen answered.
 *
 * Posting a message proves nothing about whether the card reached the screen:
 * the panel may not have its session yet, or may redraw its transcript. So an
 * offer counts as shown only when the panel says so, and until then it can be
 * posted again. Bounded, and one offer per conversation: a newer one replaces
 * the older.
 */
export class CompactionOfferLedger {
  private entries: readonly LedgerEntry[] = [];

  add(message: CompactionOfferMessage): void {
    const kept = this.entries.filter((entry) => entry.message.threadId !== message.threadId);
    this.entries = [...kept, { message, shown: false }].slice(-MAX_PENDING_COMPACTION_OFFERS);
  }

  /** True when the id is a posted, unanswered offer; a stale or guessed id is not. */
  markShown(requestId: string): boolean {
    const found = this.entries.find((entry) => entry.message.requestId === requestId);
    if (found === undefined) return false;
    this.entries = this.entries.map((entry) =>
      entry === found ? { ...entry, shown: true } : entry,
    );
    return true;
  }

  /** Forgets the offer, returning it, or nothing when it is unknown. */
  remove(requestId: string): CompactionOfferMessage | undefined {
    const found = this.entries.find((entry) => entry.message.requestId === requestId);
    this.entries = this.entries.filter((entry) => entry !== found);
    return found?.message;
  }

  /** Offers for this conversation that no panel has confirmed showing. */
  unshownFor(threadId: string): CompactionOfferMessage[] {
    return this.entries
      .filter((entry) => !entry.shown && entry.message.threadId === threadId)
      .map((entry) => entry.message);
  }

  /** Every unanswered offer for this conversation, shown or not. */
  allFor(threadId: string): CompactionOfferMessage[] {
    return this.entries
      .filter((entry) => entry.message.threadId === threadId)
      .map((entry) => entry.message);
  }

  get size(): number {
    return this.entries.length;
  }
}
