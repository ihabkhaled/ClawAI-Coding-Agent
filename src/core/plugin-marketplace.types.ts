import type { marketplaceCatalogSchema, marketplaceEntrySchema } from './plugin-marketplace.schema';
import type { z } from 'zod';

export type MarketplaceCatalog = z.infer<typeof marketplaceCatalogSchema>;
export type MarketplaceEntry = z.infer<typeof marketplaceEntrySchema>;

/** Where a marketplace's catalog is read from. */
export type MarketplaceLocation =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'folder'; readonly path: string }
  | GitMarketplaceLocation;

/** A marketplace whose catalog can be read as it is: a git one is cloned first. */
export type ReadableMarketplaceLocation = Exclude<MarketplaceLocation, GitMarketplaceLocation>;

/**
 * A `git+https://…#ref` marketplace. It is cloned into global storage and then
 * read exactly like a local folder, so the per-plugin sha256 still decides.
 */
export interface GitMarketplaceLocation {
  readonly kind: 'git';
  readonly url: string;
  /** A branch or tag; absent means the remote's default branch. */
  readonly ref?: string;
}

/**
 * Where one plugin's content is read from, and so how its digest is taken.
 *
 * An archive is hashed as the bytes that were downloaded. A folder has no bytes
 * of its own, so it is hashed as its files in a canonical order.
 */
export type PluginContentLocation =
  | { readonly kind: 'archive-url'; readonly url: string }
  | { readonly kind: 'archive-file'; readonly path: string }
  | { readonly kind: 'folder'; readonly path: string };
