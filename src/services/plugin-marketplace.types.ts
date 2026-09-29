import type { PluginStore } from './plugin-store';
import type { PluginFileSystemPort } from './plugin-store.types';
import type { PluginBundleFile } from '../core/plugin-manifest.types';
import type { MarketplaceCatalog, MarketplaceLocation } from '../core/plugin-marketplace.types';

/** What installing from a marketplace needs to reach. */
export interface PluginMarketplaceDependencies {
  readonly store: PluginStore;
  readonly files: PluginFileSystemPort;
  readonly download: (url: string) => Promise<Uint8Array>;
  readonly unzip: (bytes: Uint8Array) => Promise<PluginBundleFile[]>;
  /** The policy allowlist; undefined when no policy restricts marketplaces. */
  readonly allowlist: () => Promise<readonly string[] | undefined>;
}

/** A marketplace that was read, with where it was read from. */
export interface OpenedMarketplace {
  readonly source: string;
  readonly location: MarketplaceLocation;
  readonly catalog: MarketplaceCatalog;
}
