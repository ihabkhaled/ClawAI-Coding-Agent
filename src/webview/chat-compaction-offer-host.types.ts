import type { CompactionOfferPanel } from './chat-compaction-offer.types';

/** What the offer host needs from the provider that owns the panels. */
export interface CompactionOfferHostDependencies {
  readonly panels: () => readonly CompactionOfferPanel[];
  /** Lifts the "already offered" mark for an offer nobody will answer. */
  readonly abandoned: (requestId: string) => Promise<void>;
  /** Hands the user's answer to the host service. */
  readonly decide: (requestId: string, accept: boolean) => Promise<void>;
  /** Posts to every panel, including the sidebar. */
  readonly broadcast: (message: unknown) => Promise<void>;
}
