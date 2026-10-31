import type { RuntimeConfiguration } from './configuration-service';
import type { CompactionOffer } from '../core/compaction-trigger-offers.types';
import type { ExtensionSnapshot } from '../core/extension-state';

/** What resolving the panel's own reports needs to reach. */
export interface PanelReportCollaborators {
  readonly snapshot: () => ExtensionSnapshot;
  readonly configuration: () => RuntimeConfiguration;
  readonly workspaceRoot: () => string | undefined;
  readonly appendToComposer: (text: string) => Promise<void>;
  readonly compact: () => Promise<void>;
  /** Compacts the given conversation, or the focused one when none is named. */
  readonly compactSilently: (threadId?: string) => Promise<void>;
  /** Whether the conversation can still be compacted. */
  readonly threadExists: (threadId: string) => boolean;
  /** Shows the non-modal compaction offer; false when no panel can show it. */
  readonly offerCompaction: (offer: CompactionOffer) => Promise<boolean>;
}

export interface PanelReportHandlers {
  conversationTokens(threadId: string, tokens: number): Promise<void>;
  compactionDecision(requestId: string, accept: boolean): Promise<void>;
  compactionOfferAbandoned(requestId: string): Promise<void>;
  dropUris(uriList: string, shiftKey: boolean): Promise<void>;
}
