import * as vscode from 'vscode';

import { enabledPluginHooks } from '../core/plugin-manifest';
import { PLUGIN_DIRECTORY } from '../core/plugin-manifest.constants';
import { VscodePluginFileSystem } from '../infrastructure/vscode-plugin-file-system';

import { PluginStore } from './plugin-store';

import type { LifecycleHook } from '../core/lifecycle-hook.types';

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
