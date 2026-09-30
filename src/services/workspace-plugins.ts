import * as vscode from 'vscode';

import { pluginAgentDefinition } from '../core/plugin-agents';
import { enabledPluginHooks } from '../core/plugin-manifest';
import { PLUGIN_DIRECTORY } from '../core/plugin-manifest.constants';
import { pluginMcpServers } from '../core/plugin-mcp';
import { VscodePluginFileSystem } from '../infrastructure/vscode-plugin-file-system';

import { PluginStore } from './plugin-store';

import type { LifecycleHook } from '../core/lifecycle-hook.types';
import type { McpConfigLoad } from '../core/mcp/mcp.types';
import type { SubAgentDefinition } from '../core/sub-agent-definitions';

/**
 * The plugin store for this profile and the folder the agent is pointed at.
 *
 * User plugins live in global storage; workspace plugins in `.clawai/plugins`.
 * The folder is a function because the agent's folder can change mid-session.
 */
export function workspacePluginStore(
  globalStorageUri: vscode.Uri,
  folder: () => vscode.Uri | undefined,
): PluginStore {
  return new PluginStore(new VscodePluginFileSystem(), {
    user: () => vscode.Uri.joinPath(globalStorageUri, PLUGIN_DIRECTORY).fsPath,
    workspace: () => {
      const root = folder();
      return root === undefined
        ? undefined
        : vscode.Uri.joinPath(root, '.clawai', PLUGIN_DIRECTORY).fsPath;
    },
  });
}

/**
 * Hooks from plugins a person switched hooks on for.
 *
 * Unreadable plugins contribute nothing: a broken plugin folder should not be
 * able to stop every tool call, and it cannot add a hook by being broken.
 */
export async function pluginHooks(store: PluginStore): Promise<LifecycleHook[]> {
  try {
    return enabledPluginHooks((await store.list()).plugins);
  } catch {
    return [];
  }
}

/**
 * MCP servers from enabled plugins, for the registry to put through policy.
 *
 * A plugin store that cannot be read contributes no servers and says so,
 * rather than failing the servers the user and the project configured.
 */
export async function pluginMcpConfig(store: PluginStore): Promise<McpConfigLoad> {
  try {
    return pluginMcpServers((await store.list()).plugins);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { servers: [], errors: [`plugin MCP servers could not be read: ${message}`] };
  }
}

/**
 * Sub-agent definitions from the `agents` folders of enabled plugins.
 *
 * A file that is not a valid definition is skipped, and an unreadable store
 * contributes none, so a broken plugin never stops a sub-agent from running.
 */
export async function pluginAgents(store: PluginStore): Promise<SubAgentDefinition[]> {
  try {
    const definitions: SubAgentDefinition[] = [];
    for (const plugin of (await store.list()).plugins) {
      if (!plugin.enabled) continue;
      for (const folder of plugin.manifest.contributes.agents) {
        for (const file of await store.markdownFiles(plugin.root, folder)) {
          const definition = pluginAgentDefinition({ pluginId: plugin.id, ...file });
          if (definition !== undefined) definitions.push(definition);
        }
      }
    }
    return definitions;
  } catch {
    return [];
  }
}
