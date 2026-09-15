import type { RuntimeConfiguration } from './configuration-service';
import type { ExtensionSnapshot } from '../core/extension-state';

/** What resolving the panel's own reports needs to reach. */
export interface PanelReportCollaborators {
  readonly snapshot: () => ExtensionSnapshot;
  readonly configuration: () => RuntimeConfiguration;
  readonly workspaceRoot: () => string | undefined;
  readonly appendToComposer: (text: string) => Promise<void>;
  readonly compact: () => Promise<void>;
  readonly compactSilently: () => Promise<void>;
}

export interface PanelReportHandlers {
  conversationTokens(threadId: string, tokens: number): Promise<void>;
  dropUris(uriList: string, shiftKey: boolean): Promise<void>;
}
