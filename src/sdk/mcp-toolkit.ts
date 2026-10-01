import { z } from 'zod';

import { mcpServerNameSchema } from '../core/mcp/mcp-config';
import { mcpToolDefinition } from '../core/mcp/mcp-tool-definition';
import {
  MCP_CALL_TIMEOUT_MS,
  MCP_MAX_CALL_TIMEOUT_MS,
  MCP_TOOL_NAME,
} from '../core/mcp/mcp.constants';
import { connectMcpServer } from '../infrastructure/mcp/mcp-connection-factory';
import { McpServerRegistry } from '../services/mcp-server-registry';

import { isApproved } from './permission-modes';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type { AgentMcpOptions } from './mcp-toolkit.types';
import type { AgentPermissions } from './workspace-toolkit.types';
import type { McpServerConfig, McpSession } from '../core/mcp/mcp.types';
import type { McpTokenProvider } from '../infrastructure/mcp/mcp-transport.types';

const SDK_MCP_CLIENT_VERSION = 'sdk';

const ANONYMOUS_TOKENS: McpTokenProvider = {
  current: () => Promise.resolve(undefined),
  renew: () => Promise.resolve(undefined),
};

const toolsSchema = z.object({ server: mcpServerNameSchema }).strict();
const callSchema = z
  .object({
    server: mcpServerNameSchema,
    tool: z.string().min(1).max(200),
    arguments: z.record(z.string(), z.unknown()).default({}),
    timeoutMs: z.number().int().min(1_000).max(MCP_MAX_CALL_TIMEOUT_MS).optional(),
  })
  .strict();

/**
 * `runtime.mcp` for a host-free run: the same three operations and the same
 * server policy as the extension, over the same client.
 *
 * The tool is offered only when `permissions.allow` grants `mcp`, and each call
 * goes to `permissions.approve` like any other granted tool. What is not carried
 * over is the sign-in itself: it needs a person and a browser, so
 * a server configured with `oauth` is refused here unless `tokens` supplies
 * them, rather than half-connected.
 */
export function mcpToolkit(
  options: AgentMcpOptions,
  workspaceRoot: string,
  permissions: AgentPermissions,
): AgentToolkit {
  const registry = new McpServerRegistry({
    userConfig: () => options.config,
    workspaceConfig: () => Promise.resolve(undefined),
    projectPolicy: () => Promise.resolve(options.policy),
    organizationPolicy: () => undefined,
    workspaceTrusted: () => true,
    connect:
      options.connect ??
      ((server, signal) => connectHeadless(server, workspaceRoot, options, signal)),
  });
  const granted = permissions.allow.includes('mcp');
  return {
    definitions: granted ? [mcpToolDefinition] : [],
    authorize: async (call) => {
      if (!granted || call.toolName !== MCP_TOOL_NAME) return false;
      if (permissions.approve === undefined) return true;
      return isApproved(await permissions.approve({ ...call, category: 'mcp' }));
    },
    execute: (call, signal) => executeMcp(registry, call, signal),
    dispose: () => {
      registry.dispose();
    },
  };
}

function connectHeadless(
  server: McpServerConfig,
  workspaceRoot: string,
  options: AgentMcpOptions,
  signal: AbortSignal | undefined,
): Promise<McpSession> {
  if (server.transport === 'http' && server.oauth !== undefined && options.tokens === undefined) {
    return Promise.reject(
      new Error(
        `MCP server "${server.name}" needs an interactive OAuth sign-in, which a headless run cannot do.`,
      ),
    );
  }
  return connectMcpServer(
    server,
    {
      clientVersion: options.clientVersion ?? SDK_MCP_CLIENT_VERSION,
      workspaceRoot: () => workspaceRoot,
      tokens: (http) => options.tokens?.(http) ?? ANONYMOUS_TOKENS,
    },
    signal,
  );
}

async function executeMcp(
  registry: McpServerRegistry,
  call: AgentToolCall,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (call.operation === 'servers') {
    const report = await registry.servers();
    return { servers: report.servers, refused: report.refused, errors: report.errors };
  }
  if (call.operation === 'tools') {
    const input = toolsSchema.parse(call.arguments);
    const tools = await registry.tools(input.server, signal);
    return { server: input.server, tools, untrusted: true };
  }
  if (call.operation !== 'call') throw new Error('Unknown MCP operation');
  const input = callSchema.parse(call.arguments);
  const result = await registry.call(
    input.server,
    input.tool,
    input.arguments,
    input.timeoutMs ?? MCP_CALL_TIMEOUT_MS,
    signal,
  );
  return {
    server: input.server,
    tool: input.tool,
    isError: result.isError,
    text: result.text,
    truncated: result.truncated,
    omittedParts: [...result.omittedParts],
    untrusted: true,
  };
}
