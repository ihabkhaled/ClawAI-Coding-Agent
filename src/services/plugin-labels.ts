import * as vscode from 'vscode';

import type { InstalledPlugin, PluginScope } from '../core/plugin-manifest.types';

export function scopeLabel(scope: PluginScope): string {
  return scope === 'user' ? vscode.l10n.t('User') : vscode.l10n.t('Workspace');
}

export function contributionSummary(plugin: InstalledPlugin): string {
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

/** Version, scope and switches, the way the picker and the tree both show them. */
export function pluginStateDescription(plugin: InstalledPlugin): string {
  const state = plugin.enabled ? vscode.l10n.t('Enabled') : vscode.l10n.t('Disabled');
  const hooks = plugin.hooksEnabled ? ` · ${vscode.l10n.t('Hooks on')}` : '';
  return `${plugin.manifest.version} · ${scopeLabel(plugin.scope)} · ${state}${hooks}`;
}
