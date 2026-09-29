import type { McpFetch, McpTokenProvider } from './mcp-transport.types';
import type { McpHttpServerConfig } from '../../core/mcp/mcp.types';

export interface McpConnectionDependencies {
  readonly clientVersion: string;
  readonly workspaceRoot: () => string | undefined;
  readonly tokens: (server: McpHttpServerConfig) => McpTokenProvider;
  readonly fetch?: McpFetch;
}
