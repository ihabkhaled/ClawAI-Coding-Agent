import type { AutoCompactionMode } from '../core/compaction-trigger.types';

/** What deciding to compact automatically needs to reach. */
export interface AutoCompactionDependencies {
  readonly mode: () => AutoCompactionMode;
  /** The context window the next request will use, or nothing when unknown. */
  readonly capacity: () => number | null;
  /** A run is still writing into a conversation. */
  readonly busy: () => boolean;
  /** Asks the user, then compacts. The manual command, reused verbatim. */
  readonly compact: () => Promise<void>;
  /** Compacts without asking, for the automatic mode. */
  readonly compactSilently: () => Promise<void>;
}
