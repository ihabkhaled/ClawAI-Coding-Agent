import type { McpContentSummary, McpToolSummary } from '../core/mcp/mcp.types';
import type { McpServerReport } from '../services/mcp-server-registry.types';

/** What the MCP runtime tool needs; `McpServerRegistry` is the implementation. */
export interface McpToolPort {
  servers(): Promise<McpServerReport>;
  tools(server: string, signal?: AbortSignal): Promise<McpToolSummary[]>;
  call(
    server: string,
    tool: string,
    args: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpContentSummary>;
}
