import type { CompactionOfferMessage } from './chat-compaction-offer.types';

/** A posted offer and whether a panel has confirmed showing it. */
export interface LedgerEntry {
  readonly message: CompactionOfferMessage;
  readonly shown: boolean;
}
