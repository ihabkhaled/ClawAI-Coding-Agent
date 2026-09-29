import * as vscode from 'vscode';

import extensionPackage from '../../package.json';
import { LoopbackAuthorizationServer } from '../core/loopback-authorization';
import { MAX_MCP_CONFIG_BYTES, MCP_WORKSPACE_CONFIG_SEGMENTS } from '../core/mcp/mcp.constants';
import { connectMcpServer } from '../infrastructure/mcp/mcp-connection-factory';
import { McpToolExecutor, mcpToolDefinition } from '../infrastructure/mcp-tool-executor';

import { ConfigurationService } from './configuration-service';
import { McpOAuthService } from './mcp-oauth-service';
import { McpServerRegistry } from './mcp-server-registry';
import { ProjectPolicyService } from './project-policy-service';

import type { RuntimeToolRegistration } from './runtime-tool-router';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { ExtensionState } from '../core/extension-state';

function workspaceRoot(scope: WorkspaceScopeService): vscode.Uri | undefined {
  try {
    return scope.selectedFolder().uri;
  } catch {
    return undefined;
  }
}

async function readWorkspaceConfig(scope: WorkspaceScopeService): Promise<unknown> {
  const root = workspaceRoot(scope);
  if (root === undefined) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(root, ...MCP_WORKSPACE_CONFIG_SEGMENTS),
    );
  } catch (error: unknown) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return undefined;
    throw error;
  }
  if (bytes.byteLength > MAX_MCP_CONFIG_BYTES) throw new Error('.clawai/mcp.json is too large');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return parsed;
}

/**
 * Builds the `runtime.mcp` tool and ties its connections to the extension's
 * lifetime: every server process is closed when the extension deactivates.
 */
export function mcpToolRegistration(
  context: vscode.ExtensionContext,
  scope: WorkspaceScopeService,
  state: ExtensionState,
  configuration: ConfigurationService = new ConfigurationService(),
): RuntimeToolRegistration {
  const oauth = new McpOAuthService({
    secrets: context.secrets,
    callbacks: {
      open: (callbackState) =>
        LoopbackAuthorizationServer.open(callbackState, undefined, (message) =>
          vscode.l10n.t(message),
        ),
    },
    openBrowser: async (url) => vscode.env.openExternal(vscode.Uri.parse(url, true)),
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
  });
  const policies = new ProjectPolicyService(scope);
  const registry = new McpServerRegistry({
    userConfig: () => configuration.mcpServers(),
    workspaceConfig: () => readWorkspaceConfig(scope),
    projectPolicy: async () => (await policies.load()).mcpServers,
    organizationPolicy: () => state.snapshot.organizationPolicy?.mcpServers,
    workspaceTrusted: () => vscode.workspace.isTrusted,
    connect: (server, signal) =>
      connectMcpServer(
        server,
        {
          clientVersion: extensionPackage.version,
          workspaceRoot: () => workspaceRoot(scope)?.fsPath,
          tokens: (http) => oauth.tokenProvider(http),
        },
        signal,
      ),
  });
  context.subscriptions.push({
    dispose: () => {
      registry.dispose();
    },
  });
  return { definition: mcpToolDefinition, executor: new McpToolExecutor(registry) };
}
