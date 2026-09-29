import {
  assertSupportedProtocol,
  initializeParams,
  initializeResultSchema,
  summarizeCallResult,
  summarizeTools,
  toolsListResultSchema,
  type McpToolsListResult,
} from '../../core/mcp/mcp-protocol';
import {
  MCP_INITIALIZE_TIMEOUT_MS,
  MCP_LIST_TIMEOUT_MS,
  MCP_MAX_TOOL_PAGES,
  MCP_MAX_TOOLS_PER_SERVER,
} from '../../core/mcp/mcp.constants';

import type {
  McpContentSummary,
  McpSession,
  McpToolSummary,
  McpTransport,
} from '../../core/mcp/mcp.types';

/**
 * One initialized MCP session over any transport.
 *
 * The client advertises no capabilities of its own — no sampling, no roots, no
 * elicitation — so a server can offer tools but can never ask the extension to
 * run a model or read the workspace on its behalf.
 */
export class McpClient implements McpSession {
  private constructor(private readonly transport: McpTransport) {}

  static async connect(
    transport: McpTransport,
    clientVersion: string,
    signal?: AbortSignal,
  ): Promise<McpClient> {
    try {
      const result = await transport.request(
        'initialize',
        initializeParams(clientVersion),
        MCP_INITIALIZE_TIMEOUT_MS,
        signal,
      );
      assertSupportedProtocol(result);
      transport.setProtocolVersion?.(initializeResultSchema.parse(result).protocolVersion);
      await transport.notify('notifications/initialized', undefined);
      return new McpClient(transport);
    } catch (error: unknown) {
      transport.dispose();
      throw error;
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpToolSummary[]> {
    const tools: McpToolsListResult['tools'] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MCP_MAX_TOOL_PAGES; page += 1) {
      const result = toolsListResultSchema.parse(
        await this.transport.request(
          'tools/list',
          cursor === undefined ? {} : { cursor },
          MCP_LIST_TIMEOUT_MS,
          signal,
        ),
      );
      tools.push(...result.tools);
      cursor = result.nextCursor;
      if (cursor === undefined || tools.length >= MCP_MAX_TOOLS_PER_SERVER) break;
    }
    return summarizeTools(tools.slice(0, MCP_MAX_TOOLS_PER_SERVER));
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpContentSummary> {
    const result = await this.transport.request(
      'tools/call',
      { name, arguments: args },
      timeoutMs,
      signal,
    );
    return summarizeCallResult(result);
  }

  dispose(): void {
    this.transport.dispose();
  }
}
