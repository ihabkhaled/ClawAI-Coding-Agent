import type { PluginStore } from './plugin-store';
import type { PluginFileSystemPort } from './plugin-store.types';
import type { PluginBundleFile } from '../core/plugin-manifest.types';
import type {
  GitMarketplaceLocation,
  MarketplaceCatalog,
  ReadableMarketplaceLocation,
} from '../core/plugin-marketplace.types';

/** What installing from a marketplace needs to reach. */
export interface PluginMarketplaceDependencies {
  readonly store: PluginStore;
  readonly files: PluginFileSystemPort;
  readonly download: (url: string) => Promise<Uint8Array>;
  readonly unzip: (bytes: Uint8Array) => Promise<PluginBundleFile[]>;
  /**
   * Clones a `git+https` marketplace shallowly and returns the folder it is in.
   * Absent where no clone can run, which refuses git marketplaces.
   */
  readonly cloneGit?: (location: GitMarketplaceLocation) => Promise<string>;
  /** The policy allowlist; undefined when no policy restricts marketplaces. */
  readonly allowlist: () => Promise<readonly string[] | undefined>;
}

/** A marketplace that was read, with where it was read from. */
export interface OpenedMarketplace {
  readonly source: string;
  /** A git marketplace is recorded as the folder it was cloned into. */
  readonly location: ReadableMarketplaceLocation;
  readonly catalog: MarketplaceCatalog;
}
