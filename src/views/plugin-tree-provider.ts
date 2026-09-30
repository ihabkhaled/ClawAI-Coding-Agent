import * as vscode from 'vscode';

import { contributionSummary, pluginStateDescription, scopeLabel } from '../services/plugin-labels';

import {
  PLUGIN_CONTEXT_DISABLED,
  PLUGIN_CONTEXT_ENABLED,
  PLUGIN_CONTEXT_INVALID,
  PLUGIN_VIEW_ID,
} from './plugin-tree-provider.constants';
import { recordTreeProbe } from './tree-probe';

import type { PluginListing, PluginTreeNode } from './plugin-tree-provider.types';
import type { InstalledPlugin, InvalidPlugin } from '../core/plugin-manifest.types';

function pluginIcon(plugin: InstalledPlugin): string {
  if (plugin.needsApproval) return 'shield';
  return plugin.enabled ? 'extensions' : 'circle-slash';
}

function pluginItem(plugin: InstalledPlugin): vscode.TreeItem {
  const item = new vscode.TreeItem(plugin.id, vscode.TreeItemCollapsibleState.None);
  item.description = pluginStateDescription(plugin);
  item.tooltip = [
    plugin.needsApproval
      ? vscode.l10n.t(
          'Workspace plugin: it came with this repository and does nothing until you enable it.',
        )
      : '',
    plugin.manifest.description,
    contributionSummary(plugin),
    plugin.root,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
  item.iconPath = new vscode.ThemeIcon(pluginIcon(plugin));
  item.contextValue = plugin.enabled ? PLUGIN_CONTEXT_ENABLED : PLUGIN_CONTEXT_DISABLED;
  return item;
}

function invalidItem(problem: InvalidPlugin): vscode.TreeItem {
  const item = new vscode.TreeItem(problem.root, vscode.TreeItemCollapsibleState.None);
  item.description = scopeLabel(problem.scope);
  item.tooltip = vscode.l10n.t('Not a valid plugin: {0}', problem.error);
  item.iconPath = new vscode.ThemeIcon('warning');
  item.contextValue = PLUGIN_CONTEXT_INVALID;
  return item;
}

/**
 * The Plugins view: every installed plugin with its switches, and every folder
 * that looked like a plugin and was not one, with the reason.
 *
 * It reads the same plugin store the "Manage Plugins" picker does, so the two
 * can never disagree. A store that cannot be read shows nothing rather than an
 * error row: the view is a window onto the store, not a second source of truth.
 */
export class PluginTreeProvider implements vscode.TreeDataProvider<PluginTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<PluginTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly listing: PluginListing) {
    recordTreeProbe(PLUGIN_VIEW_ID, this);
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: PluginTreeNode): vscode.TreeItem {
    return node.kind === 'plugin' ? pluginItem(node.plugin) : invalidItem(node.problem);
  }

  async getChildren(node?: PluginTreeNode): Promise<PluginTreeNode[]> {
    if (node !== undefined) return [];
    try {
      const { plugins, invalid } = await this.listing();
      return [
        ...plugins.map((plugin) => ({ kind: 'plugin' as const, plugin })),
        ...invalid.map((problem) => ({ kind: 'invalid' as const, problem })),
      ];
    } catch {
      return [];
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
