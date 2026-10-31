import { MAX_PENDING_COMPACTION_OFFERS } from './compaction-trigger.constants';

import type { PendingCompactionOffer } from './compaction-trigger-offers.types';

/** How much of the prompt allowance is spent, as a whole percent capped at 100. */
export function usedPercentOf(availableForPrompt: number, spentTokens: number): number {
  if (!(availableForPrompt > 0) || !(spentTokens > 0)) return 0;
  return Math.min(100, Math.round((spentTokens / availableForPrompt) * 100));
}

/**
 * The offers that were shown and have not been answered.
 *
 * An answer is accepted once and only for an offer this host actually made, so a
 * stale card, a replayed message or a guessed id changes nothing. Bounded: a
 * session that raises offers forever cannot grow it without limit.
 */
export class PendingCompactionOffers {
  private offers: readonly PendingCompactionOffer[] = [];

  /** Records an offer; a newer offer for the same conversation replaces the older one. */
  add(offer: PendingCompactionOffer): void {
    const kept = this.offers.filter((entry) => entry.threadId !== offer.threadId);
    this.offers = [...kept, offer].slice(-MAX_PENDING_COMPACTION_OFFERS);
  }

  /** Removes and returns the offer for this id, or nothing when it is unknown or already answered. */
  take(requestId: string): PendingCompactionOffer | undefined {
    const found = this.offers.find((entry) => entry.requestId === requestId);
    if (found !== undefined) {
      this.offers = this.offers.filter((entry) => entry !== found);
    }
    return found;
  }

  get size(): number {
    return this.offers.length;
  }
}
