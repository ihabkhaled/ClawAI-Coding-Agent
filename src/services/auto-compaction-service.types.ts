import type { CompactionOffer } from '../core/compaction-trigger-offers.types';
import type { AutoCompactionMode } from '../core/compaction-trigger.types';

/** What deciding to compact automatically needs to reach. */
export interface AutoCompactionDependencies {
  readonly mode: () => AutoCompactionMode;
  /** The context window the next request will use, or nothing when unknown. */
  readonly capacity: () => number | null;
  /** A run is still writing into a conversation. */
  readonly busy: () => boolean;
  /** Asks the user in a modal, then compacts. The manual command, reused verbatim. */
  readonly compact: () => Promise<void>;
  /**
   * Compacts without asking, for the automatic mode and for an accepted inline
   * offer. An offer names its conversation; with no name the focused one is used.
   */
  readonly compactSilently: (threadId?: string) => Promise<void>;
  /** Whether the conversation still exists. Absent means it is assumed to. */
  readonly threadExists?: (threadId: string) => boolean;
  /**
   * Shows the non-modal offer in the conversation's panel. Resolves true when a
   * panel received it, false when none is open, in which case the modal is used.
   */
  readonly offerInline?: (offer: CompactionOffer) => Promise<boolean>;
  /** A fresh id for an offer; defaults to a random UUID. */
  readonly newRequestId?: () => string;
}

/** What answering an inline offer did. */
export type CompactionDecisionOutcome = 'compacted' | 'declined' | 'ignored' | 'refused';
