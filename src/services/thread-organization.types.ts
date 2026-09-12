import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';

/** What renaming and archiving a conversation needs to reach. */
export interface ThreadOrganizationDependencies {
  readonly backend: () => BackendClient;
  readonly state: () => ExtensionState;
  /** Re-reads the thread list so the change is visible without a reconnect. */
  readonly refreshHistory: () => Promise<void>;
}
