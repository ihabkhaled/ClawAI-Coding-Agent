import * as vscode from 'vscode';

import { pluginFailureMessage } from './plugin-failure-message';
import { browsePluginMarketplaces, pickScope } from './plugin-marketplace-commands';

import type {
  PluginActionItem,
  PluginCommandDependencies,
  PluginPickItem,
} from './plugin-commands.types';
import type { InstalledPlugin, PluginScope } from '../core/plugin-manifest.types';

function scopeLabel(scope: PluginScope): string {
  return scope === 'user' ? vscode.l10n.t('User') : vscode.l10n.t('Workspace');
}

function contributionSummary(plugin: InstalledPlugin): string {
  const contributes = plugin.manifest.contributes;
  return vscode.l10n.t(
    'Skills {0} · Commands {1} · Styles {2} · Agents {3} · Hooks {4} · MCP servers {5}',
    contributes.skills.length,
    contributes.commands.length,
    contributes.outputStyles.length,
    contributes.agents.length,
    contributes.hooks.length,
    Object.keys(contributes.mcpServers).length,
  );
}

function pluginItem(plugin: InstalledPlugin): PluginPickItem {
  const state = plugin.enabled ? vscode.l10n.t('Enabled') : vscode.l10n.t('Disabled');
  const hooks = plugin.hooksEnabled ? ` · ${vscode.l10n.t('Hooks on')}` : '';
  return {
    label: `$(extensions) ${plugin.id}`,
    description: `${plugin.manifest.version} · ${scopeLabel(plugin.scope)} · ${state}${hooks}`,
    detail: `${plugin.manifest.description} ${contributionSummary(plugin)}`.trim(),
    plugin,
  };
}

async function installFromFolder(dependencies: PluginCommandDependencies): Promise<void> {
  const chosen = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Install plugin'),
  });
  const folder = chosen?.[0];
  if (folder === undefined) return;
  const scope = await pickScope(dependencies);
  if (scope === undefined) return;
  try {
    const root = await dependencies.marketplace.installFolder(folder.fsPath, scope);
    await vscode.window.showInformationMessage(vscode.l10n.t('Installed {0}.', root));
  } catch (error: unknown) {
    await vscode.window.showErrorMessage(pluginFailureMessage(error));
  }
}

/**
 * Turning hooks on is the one switch that lets a plugin run commands, so it
 * names every command and needs a trusted workspace and an explicit yes.
 */
async function enableHooks(
  dependencies: PluginCommandDependencies,
  plugin: InstalledPlugin,
): Promise<void> {
  if (!dependencies.trusted()) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('Plugin hooks can only run in a trusted workspace.'),
    );
    return;
  }
  const commands = plugin.manifest.contributes.hooks.map((hook) => hook.command).join(', ');
  const turnOn = vscode.l10n.t('Turn on');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Turn on hooks for {0}? They run these commands: {1}', plugin.id, commands),
    { modal: true },
    turnOn,
  );
  if (answer !== turnOn) return;
  await dependencies.store.setSwitches(plugin, { enabled: true, hooksEnabled: true });
}

async function uninstall(
  dependencies: PluginCommandDependencies,
  plugin: InstalledPlugin,
): Promise<void> {
  const confirm = vscode.l10n.t('Uninstall');
  const answer = await vscode.window.showWarningMessage(
    vscode.l10n.t('Uninstall {0}?', plugin.id),
    { modal: true },
    confirm,
  );
  if (answer === confirm) await dependencies.store.uninstall(plugin);
}

function actionsFor(
  dependencies: PluginCommandDependencies,
  plugin: InstalledPlugin,
): PluginActionItem[] {
  const store = dependencies.store;
  const actions: PluginActionItem[] = [
    plugin.enabled
      ? {
          label: vscode.l10n.t('Disable'),
          run: () => store.setSwitches(plugin, { enabled: false, hooksEnabled: false }),
        }
      : {
          label: vscode.l10n.t('Enable'),
          run: () => store.setSwitches(plugin, { enabled: true, hooksEnabled: false }),
        },
  ];
  if (plugin.manifest.contributes.hooks.length > 0) {
    actions.push(
      plugin.hooksEnabled
        ? {
            label: vscode.l10n.t('Turn hooks off'),
            run: () => store.setSwitches(plugin, { enabled: plugin.enabled, hooksEnabled: false }),
          }
        : { label: vscode.l10n.t('Turn hooks on'), run: () => enableHooks(dependencies, plugin) },
    );
  }
  actions.push({ label: vscode.l10n.t('Uninstall'), run: () => uninstall(dependencies, plugin) });
  return actions;
}

async function managePlugin(
  dependencies: PluginCommandDependencies,
  plugin: InstalledPlugin,
): Promise<void> {
  const action = await vscode.window.showQuickPick(actionsFor(dependencies, plugin), {
    placeHolder: plugin.id,
  });
  if (action === undefined) return;
  try {
    await action.run();
  } catch (error: unknown) {
    await vscode.window.showErrorMessage(pluginFailureMessage(error));
  }
}

/**
 * The plugin manager: every installed plugin, what it contributes, and what is
 * switched on. Folders that are not valid plugins are listed with the reason,
 * because a plugin that silently does not appear is the hardest one to fix.
 */
export async function managePlugins(dependencies: PluginCommandDependencies): Promise<void> {
  const { plugins, invalid } = await dependencies.store.list();
  const items: PluginPickItem[] = [
    {
      label: `$(cloud-download) ${vscode.l10n.t('Browse plugin marketplaces…')}`,
      action: 'browse',
    },
    {
      label: `$(folder-opened) ${vscode.l10n.t('Install a plugin from a folder…')}`,
      action: 'install-folder',
    },
    ...plugins.map(pluginItem),
    ...invalid.map((problem) => ({
      label: `$(warning) ${problem.root}`,
      description: scopeLabel(problem.scope),
      detail: vscode.l10n.t('Not a valid plugin: {0}', problem.error),
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Pick a plugin to manage'),
    matchOnDetail: true,
  });
  if (picked?.action === 'browse') return browsePluginMarketplaces(dependencies);
  if (picked?.action === 'install-folder') return installFromFolder(dependencies);
  if (picked?.plugin !== undefined) await managePlugin(dependencies, picked.plugin);
}
