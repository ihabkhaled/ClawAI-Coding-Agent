import * as vscode from 'vscode';

import type { InstalledPlugin, PluginScope } from '../core/plugin-manifest.types';
import type { SignatureVerdict } from '../core/plugin-signature.types';

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

/** The signed-by or unsigned badge; nothing for a plugin installed before signatures were recorded. */
export function signatureBadge(plugin: InstalledPlugin): string | undefined {
  if (plugin.signature === undefined) return undefined;
  return plugin.signature.signedBy === undefined
    ? vscode.l10n.t('Unsigned')
    : vscode.l10n.t('Signed by {0}', plugin.signature.signedBy);
}

/** A catalog entry's signature verdict as the picker shows it. */
export function verdictLabel(verdict: SignatureVerdict): string {
  return verdict.status === 'signed'
    ? vscode.l10n.t('Signed by {0}', verdict.signer)
    : vscode.l10n.t('Unsigned');
}

/** Version, scope and switches, the way the picker and the tree both show them. */
export function pluginStateDescription(plugin: InstalledPlugin): string {
  const state = plugin.enabled ? vscode.l10n.t('Enabled') : vscode.l10n.t('Disabled');
  const hooks = plugin.hooksEnabled ? ` · ${vscode.l10n.t('Hooks on')}` : '';
  const badge = signatureBadge(plugin);
  const signature = badge === undefined ? '' : ` · ${badge}`;
  return `${plugin.manifest.version} · ${scopeLabel(plugin.scope)} · ${state}${hooks}${signature}`;
}
