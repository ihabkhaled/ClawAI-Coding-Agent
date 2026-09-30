import { PluginFailure } from '../core/plugin-failure';
import { manifestInBundle } from '../core/plugin-manifest';
import { MARKETPLACE_CATALOG_FILE } from '../core/plugin-manifest.constants';
import {
  catalogPath,
  entryContentLocation,
  folderDigest,
  marketplaceAllowed,
  marketplaceLocation,
  sha256Hex,
} from '../core/plugin-marketplace';
import { marketplaceCatalogSchema } from '../core/plugin-marketplace.schema';

import type { OpenedMarketplace, PluginMarketplaceDependencies } from './plugin-marketplace.types';
import type { PluginBundleFile, PluginScope } from '../core/plugin-manifest.types';
import type {
  MarketplaceEntry,
  MarketplaceLocation,
  PluginContentLocation,
  ReadableMarketplaceLocation,
} from '../core/plugin-marketplace.types';

const decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Browsing and installing from plugin marketplaces.
 *
 * The integrity check is a sha256 the catalog pins for each plugin, compared
 * before anything is written. That proves the bytes are the ones the catalog
 * named; it does not prove who wrote the catalog. There is no publisher
 * signature, and nothing here claims otherwise — trust in a marketplace is the
 * user's decision to add it, narrowed by any policy allowlist.
 */
export class PluginMarketplaceService {
  constructor(private readonly dependencies: PluginMarketplaceDependencies) {}

  async open(source: string): Promise<OpenedMarketplace> {
    const location = await this.fetched(await this.permitted(source));
    const bytes = await this.readCatalog(location);
    let candidate: unknown;
    try {
      candidate = JSON.parse(decoder.decode(bytes));
    } catch {
      throw new PluginFailure('invalid-catalog', 'not valid JSON');
    }
    const parsed = marketplaceCatalogSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new PluginFailure('invalid-catalog', parsed.error.issues[0]?.message ?? '');
    }
    return { source, location, catalog: parsed.data };
  }

  /** Downloads, verifies, and only then writes. A mismatch leaves the disk untouched. */
  async install(
    marketplace: OpenedMarketplace,
    entry: MarketplaceEntry,
    scope: PluginScope,
  ): Promise<string> {
    // Checked again: policy can change between browsing and choosing.
    await this.permitted(marketplace.source);
    const content = entryContentLocation(marketplace.location, entry);
    if (content === undefined) throw new PluginFailure('invalid-source', entry.source);
    const files = await this.verifiedContent(content, entry);
    const manifest = manifestInBundle(files);
    if (!manifest.ok) throw new PluginFailure('invalid-manifest', manifest.error);
    const { name, publisher, version } = manifest.manifest;
    if (name !== entry.name || publisher !== entry.publisher || version !== entry.version) {
      throw new PluginFailure('name-mismatch', `${publisher}.${name}@${version}`);
    }
    return this.dependencies.store.install(scope, files);
  }

  /** A folder the user picked themselves. No digest: they are the source. */
  async installFolder(path: string, scope: PluginScope): Promise<string> {
    const files = await this.dependencies.store.readTree(path);
    return this.dependencies.store.install(scope, files);
  }

  private async permitted(source: string): Promise<MarketplaceLocation> {
    if (!marketplaceAllowed(source, await this.dependencies.allowlist())) {
      throw new PluginFailure('not-allowed', source);
    }
    const location = marketplaceLocation(source);
    if (location === undefined) throw new PluginFailure('invalid-source', source);
    return location;
  }

  /**
   * A git marketplace, cloned and from then on a local folder. The catalog and
   * every plugin are read from the clone, and each plugin's sha256 still has
   * to match; the clone only moves the bytes, it does not vouch for them.
   */
  private async fetched(location: MarketplaceLocation): Promise<ReadableMarketplaceLocation> {
    if (location.kind !== 'git') return location;
    const clone = this.dependencies.cloneGit;
    if (clone === undefined) throw new PluginFailure('invalid-source', location.url);
    return { kind: 'folder', path: await clone(location) };
  }

  private async readCatalog(location: ReadableMarketplaceLocation): Promise<Uint8Array> {
    if (location.kind === 'url') return this.dependencies.download(location.url);
    const bytes = await this.dependencies.files.readFile(
      catalogPath(location.path, MARKETPLACE_CATALOG_FILE),
    );
    if (bytes === undefined) throw new PluginFailure('unreachable', location.path);
    return bytes;
  }

  private async verifiedContent(
    content: PluginContentLocation,
    entry: MarketplaceEntry,
  ): Promise<PluginBundleFile[]> {
    if (content.kind === 'folder') {
      const files = await this.dependencies.store.readTree(content.path);
      if (folderDigest(files) !== entry.sha256) {
        throw new PluginFailure('digest-mismatch', entry.name);
      }
      return files;
    }
    const bytes =
      content.kind === 'archive-url'
        ? await this.dependencies.download(content.url)
        : await this.dependencies.files.readFile(content.path);
    if (bytes === undefined) throw new PluginFailure('unreachable', entry.source);
    // Hashed before it is unpacked, so a hostile archive never reaches the zip
    // parser unless it is the exact archive the catalog pinned.
    if (sha256Hex(bytes) !== entry.sha256) throw new PluginFailure('digest-mismatch', entry.name);
    return this.dependencies.unzip(bytes);
  }
}
