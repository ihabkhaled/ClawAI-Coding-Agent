import type { McpFetch } from '../infrastructure/mcp/mcp-transport.types';

/** SecretStorage, narrowed to what the OAuth flow needs. */
export interface McpSecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

/** The loopback callback listener, as `LoopbackAuthorizationServer` provides it. */
export interface McpAuthorizationCallback {
  readonly callbackUri: string;
  waitForCallback(): Promise<string>;
  confirmAuthorization(): void;
  rejectAuthorization(): void;
  dispose(): void;
}

export interface McpOAuthDependencies {
  readonly secrets: McpSecretStore;
  readonly callbacks: { open(state: string): Promise<McpAuthorizationCallback> };
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly fetch: McpFetch;
  readonly now: () => number;
}
