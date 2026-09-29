import type { PluginMarketplaceService } from './plugin-marketplace-service';
import type { PluginStore } from './plugin-store';
import type { InstalledPlugin } from '../core/plugin-manifest.types';
import type { MarketplaceEntry } from '../core/plugin-marketplace.types';
import type * as vscode from 'vscode';

/** What the plugin commands need to reach. */
export interface PluginCommandDependencies {
  readonly store: PluginStore;
  readonly marketplace: PluginMarketplaceService;
  /** Whether VS Code trusts this workspace; plugin hooks need it. */
  readonly trusted: () => boolean;
  readonly marketplaces: () => readonly string[];
  readonly saveMarketplaces: (sources: readonly string[]) => Promise<void>;
  readonly allowlist: () => Promise<readonly string[] | undefined>;
}

/** A plugin as a row in the manage picker. */
export interface PluginPickItem extends vscode.QuickPickItem {
  readonly plugin?: InstalledPlugin;
  readonly action?: 'browse' | 'install-folder';
}

/** One action on a chosen plugin. */
export interface PluginActionItem extends vscode.QuickPickItem {
  readonly run: () => Promise<void>;
}

/** A marketplace, or an action on the list of them, as a picker row. */
export interface MarketplacePickItem extends vscode.QuickPickItem {
  readonly source?: string;
  readonly action?: 'add' | 'remove';
}

/** A plugin a marketplace offers, as a picker row. */
export interface MarketplaceEntryItem extends vscode.QuickPickItem {
  readonly entry: MarketplaceEntry;
}
