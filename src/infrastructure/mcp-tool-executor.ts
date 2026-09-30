import { z } from 'zod';

import { mcpServerNameSchema } from '../core/mcp/mcp-config';
import {
  MCP_CALL_TIMEOUT_MS,
  MCP_MAX_CALL_TIMEOUT_MS,
  MCP_TOOL_NAME,
} from '../core/mcp/mcp.constants';

import type { McpToolPort } from './mcp-tool-executor.types';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export { mcpToolDefinition } from '../core/mcp/mcp-tool-definition';

const toolsSchema = z.object({ server: mcpServerNameSchema }).strict();

const callSchema = z
  .object({
    server: mcpServerNameSchema,
    tool: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.unknown()).default({}),
    timeoutMs: z.number().int().min(1_000).max(MCP_MAX_CALL_TIMEOUT_MS).optional(),
  })
  .strict();

/** The agent's single way onto every configured MCP server. */
export class McpToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly mcp: McpToolPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== MCP_TOOL_NAME) throw new Error('Unknown MCP tool');
    if (invocation.operation === 'servers') {
      const report = await this.mcp.servers();
      return {
        structured: {
          servers: report.servers.map((server) => ({ ...server })),
          refused: report.refused.map((refusal) => ({ ...refusal })),
          errors: [...report.errors],
        },
      };
    }
    if (invocation.operation === 'tools') {
      const input = toolsSchema.parse(invocation.arguments);
      const tools = await this.mcp.tools(input.server, signal);
      return {
        structured: {
          server: input.server,
          tools: tools.map((tool) => ({ ...tool })),
          untrusted: true,
        },
      };
    }
    if (invocation.operation !== 'call') throw new Error('Unknown MCP operation');
    const input = callSchema.parse(invocation.arguments);
    const result = await this.mcp.call(
      input.server,
      input.tool,
      input.arguments,
      input.timeoutMs ?? MCP_CALL_TIMEOUT_MS,
      signal,
    );
    return {
      structured: {
        server: input.server,
        tool: input.tool,
        isError: result.isError,
        text: result.text,
        truncated: result.truncated,
        omittedParts: [...result.omittedParts],
        untrusted: true,
      },
    };
  }
}
