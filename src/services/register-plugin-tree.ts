import * as vscode from 'vscode';

import { PluginTreeProvider } from '../views/plugin-tree-provider';
import { PLUGIN_VIEW_ID } from '../views/plugin-tree-provider.constants';

import { uninstallPlugin } from './plugin-commands';
import { pluginFailureMessage } from './plugin-failure-message';

import type { PluginCommandDependencies } from './plugin-commands.types';
import type { InstalledPlugin } from '../core/plugin-manifest.types';
import type { PluginTreeNode } from '../views/plugin-tree-provider.types';

/**
 * The Plugins view and its row actions: enable, disable, uninstall, refresh.
 *
 * Every action goes through the same plugin store and the same confirmation
 * as the "Manage Plugins" picker. Enabling never turns hooks on — that stays
 * the picker's explicit, trust-gated step, because hooks run commands.
 */
export function registerPluginTree(
  context: vscode.ExtensionContext,
  dependencies: PluginCommandDependencies,
): PluginTreeProvider {
  const store = dependencies.store;
  const tree = new PluginTreeProvider(() => store.list());
  const onPlugin =
    (run: (plugin: InstalledPlugin) => Promise<void>) =>
    async (node?: PluginTreeNode): Promise<void> => {
      if (node?.kind !== 'plugin') return;
      try {
        await run(node.plugin);
      } catch (error: unknown) {
        await vscode.window.showErrorMessage(pluginFailureMessage(error));
      } finally {
        tree.refresh();
      }
    };
  context.subscriptions.push(
    tree,
    vscode.window.registerTreeDataProvider(PLUGIN_VIEW_ID, tree),
    vscode.commands.registerCommand(
      'clawAI.enablePlugin',
      onPlugin((plugin) => store.setSwitches(plugin, { enabled: true, hooksEnabled: false })),
    ),
    vscode.commands.registerCommand(
      'clawAI.disablePlugin',
      onPlugin((plugin) => store.setSwitches(plugin, { enabled: false, hooksEnabled: false })),
    ),
    vscode.commands.registerCommand(
      'clawAI.uninstallPlugin',
      onPlugin((plugin) => uninstallPlugin(dependencies, plugin)),
    ),
    vscode.commands.registerCommand('clawAI.refreshPlugins', () => {
      tree.refresh();
    }),
  );
  return tree;
}
