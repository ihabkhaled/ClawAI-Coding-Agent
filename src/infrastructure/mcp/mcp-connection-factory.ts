import path from 'node:path';

import { McpClient } from './mcp-client';
import { McpHttpTransport } from './mcp-http-transport';
import { McpStdioTransport } from './mcp-stdio-transport';

import type { McpConnectionDependencies } from './mcp-connection-factory.types';
import type { McpTokenProvider } from './mcp-transport.types';
import type { McpServerConfig, McpStdioServerConfig } from '../../core/mcp/mcp.types';

const anonymous: McpTokenProvider = {
  current: () => Promise.resolve(undefined),
  renew: () => Promise.resolve(undefined),
};

/**
 * Where a stdio server starts. A workspace-declared `cwd` must stay inside the
 * workspace; a user-level one may be anywhere, because the user wrote it.
 */
export function resolveStdioCwd(
  server: McpStdioServerConfig,
  workspaceRoot: string | undefined,
): string | undefined {
  if (server.cwd === undefined) return workspaceRoot;
  if (server.origin === 'user' && path.isAbsolute(server.cwd)) return server.cwd;
  if (workspaceRoot === undefined) throw new Error('MCP server cwd needs an open workspace');
  const resolved = path.resolve(workspaceRoot, server.cwd);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`MCP server "${server.name}" cwd leaves the workspace`);
  }
  return resolved;
}

export function connectMcpServer(
  server: McpServerConfig,
  deps: McpConnectionDependencies,
  signal?: AbortSignal,
): Promise<McpClient> {
  if (server.transport === 'stdio') {
    const transport = McpStdioTransport.start({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: resolveStdioCwd(server, deps.workspaceRoot()),
    });
    return McpClient.connect(transport, deps.clientVersion, signal);
  }
  const tokens = server.oauth === undefined ? anonymous : deps.tokens(server);
  const transport = new McpHttpTransport(
    { url: server.url, headers: server.headers },
    tokens,
    deps.fetch,
  );
  return McpClient.connect(transport, deps.clientVersion, signal);
}
