import type { McpServerConfig, McpSession } from '../core/mcp/mcp.types';

/**
 * MCP servers a run may use.
 *
 * `config` has the same shape as the extension's MCP file: `{ "servers": {...} }`
 * or `{ "mcpServers": {...} }`. `policy` is the extension's server policy,
 * `{ allow: [...], deny: [...] }` over name, command and url; deny wins, and a
 * malformed policy denies everything. Servers are supplied by the caller, so
 * they count as user-declared and the workspace is treated as trusted.
 */
export interface AgentMcpOptions {
  readonly config: unknown;
  readonly policy?: unknown;
  /** Substituted in tests, or to reach a server by some other transport. */
  readonly connect?:
    ((server: McpServerConfig, signal?: AbortSignal) => Promise<McpSession>) | undefined;
  readonly clientVersion?: string | undefined;
}
