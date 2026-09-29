import type { BackendClient } from '../backend/backend-client';

/** What the remote-job and channel commands need from the composed extension. */
export interface RemoteChannelDependencies {
  readonly backend: () => BackendClient;
  readonly signedIn: () => boolean;
  /** Puts text into the chat composer, visible to the user, who decides whether to send it. */
  readonly insert: (block: string) => Promise<void>;
  readonly enabled: () => boolean;
  readonly enable: () => Promise<void>;
}
