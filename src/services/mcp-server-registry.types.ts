import type {
  McpServerConfig,
  McpServerOrigin,
  McpServerRefusal,
  McpSession,
} from '../core/mcp/mcp.types';

export interface McpRegistryDependencies {
  /** The user-level `clawAI.mcp.servers` setting, never the workspace value. */
  readonly userConfig: () => unknown;
  /** `.clawai/mcp.json`, parsed; `undefined` when the file does not exist. */
  readonly workspaceConfig: () => Promise<unknown>;
  /** The `mcpServers` block of `.clawai/policies/policy.json`. */
  readonly projectPolicy: () => Promise<unknown>;
  /** The `mcpServers` block of the managed organization policy. */
  readonly organizationPolicy: () => unknown;
  readonly workspaceTrusted: () => boolean;
  readonly connect: (server: McpServerConfig, signal?: AbortSignal) => Promise<McpSession>;
}

export interface McpServerListing {
  readonly name: string;
  readonly origin: McpServerOrigin;
  readonly transport: McpServerConfig['transport'];
  /** The command for stdio, the URL for HTTP: what the user would recognise. */
  readonly target: string;
  readonly connected: boolean;
  readonly oauth: boolean;
}

export interface McpServerReport {
  readonly servers: readonly McpServerListing[];
  readonly refused: readonly McpServerRefusal[];
  readonly errors: readonly string[];
}
