import * as vscode from 'vscode';

import { marketplaceAllowed } from '../core/plugin-marketplace';

import { pluginFailureMessage } from './plugin-failure-message';
import { verdictLabel } from './plugin-labels';

import type {
  MarketplaceEntryItem,
  MarketplacePickItem,
  PluginCommandDependencies,
} from './plugin-commands.types';
import type { PluginScope } from '../core/plugin-manifest.types';

/** Asks for a scope; the workspace is offered only when a folder is open. */
export async function pickScope(
  dependencies: PluginCommandDependencies,
): Promise<PluginScope | undefined> {
  if (dependencies.store.rootFor('workspace') === undefined) return 'user';
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('User'), scope: 'user' as const },
      { label: vscode.l10n.t('Workspace'), scope: 'workspace' as const },
    ],
    { placeHolder: vscode.l10n.t('Install for this profile or this workspace?') },
  );
  return picked?.scope;
}

async function addMarketplace(dependencies: PluginCommandDependencies): Promise<void> {
  const source = await vscode.window.showInputBox({
    prompt: vscode.l10n.t(
      'Marketplace: an https catalog URL, git+https://…#ref, or a local folder path',
    ),
    ignoreFocusOut: true,
  });
  const trimmed = source?.trim() ?? '';
  if (trimmed === '' || dependencies.marketplaces().includes(trimmed)) return;
  await dependencies.saveMarketplaces([...dependencies.marketplaces(), trimmed]);
}

async function removeMarketplace(dependencies: PluginCommandDependencies): Promise<void> {
  const picked = await vscode.window.showQuickPick([...dependencies.marketplaces()], {
    placeHolder: vscode.l10n.t('Pick a marketplace to remove'),
  });
  if (picked === undefined) return;
  await dependencies.saveMarketplaces(
    dependencies.marketplaces().filter((source) => source !== picked),
  );
}

async function installFromMarketplace(
  dependencies: PluginCommandDependencies,
  source: string,
): Promise<void> {
  const opened = await dependencies.marketplace.open(source);
  const items: MarketplaceEntryItem[] = await Promise.all(
    opened.catalog.plugins.map(async (entry) => ({
      label: `${entry.publisher}.${entry.name}`,
      description: `${entry.version} · ${verdictLabel(await dependencies.marketplace.verdictOf(entry))}`,
      detail: entry.description,
      entry,
    })),
  );
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: vscode.l10n.t('Pick a plugin to install'),
    matchOnDetail: true,
  });
  if (picked === undefined) return;
  const scope = await pickScope(dependencies);
  if (scope === undefined) return;
  await dependencies.marketplace.install(opened, picked.entry, scope);
  await vscode.window.showInformationMessage(vscode.l10n.t('Installed {0}.', picked.label));
}

async function marketplaceItems(
  dependencies: PluginCommandDependencies,
): Promise<MarketplacePickItem[]> {
  const allowlist = await dependencies.allowlist();
  return [
    ...dependencies.marketplaces().map((source) => ({
      label: `$(package) ${source}`,
      description: marketplaceAllowed(source, allowlist) ? '' : vscode.l10n.t('Blocked by policy'),
      source,
    })),
    { label: `$(add) ${vscode.l10n.t('Add a marketplace…')}`, action: 'add' as const },
    { label: `$(trash) ${vscode.l10n.t('Remove a marketplace…')}`, action: 'remove' as const },
  ];
}

/**
 * Configured marketplaces: open one to install from it, or change the list.
 *
 * A marketplace policy refuses is still listed, marked, so the user sees why
 * it cannot be opened instead of wondering where it went.
 */
export async function browsePluginMarketplaces(
  dependencies: PluginCommandDependencies,
): Promise<void> {
  const picked = await vscode.window.showQuickPick(await marketplaceItems(dependencies), {
    placeHolder: vscode.l10n.t('Pick a marketplace'),
  });
  try {
    if (picked?.action === 'add') await addMarketplace(dependencies);
    else if (picked?.action === 'remove') await removeMarketplace(dependencies);
    else if (picked?.source !== undefined)
      await installFromMarketplace(dependencies, picked.source);
  } catch (error: unknown) {
    await vscode.window.showErrorMessage(pluginFailureMessage(error));
  }
}
