import { createHash } from 'node:crypto';

import { isContainedRelativePath } from './plugin-path';

import type { PluginBundleFile } from './plugin-manifest.types';
import type {
  MarketplaceEntry,
  MarketplaceLocation,
  PluginContentLocation,
} from './plugin-marketplace.types';

/**
 * What a configured marketplace string refers to.
 *
 * `https` or an absolute local folder. Plain `http` is refused: a digest in a
 * catalog fetched in the clear can be swapped along with the archive it pins.
 */
export function marketplaceLocation(source: string): MarketplaceLocation | undefined {
  const trimmed = source.trim();
  if (trimmed.startsWith('https://')) {
    return URL.canParse(trimmed) ? { kind: 'url', url: trimmed } : undefined;
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(trimmed)) {
    return { kind: 'folder', path: trimmed };
  }
  return undefined;
}

function normalizeMarketplace(source: string): string {
  return source.trim().replace(/[\\/]+$/u, '');
}

/**
 * Whether policy lets this marketplace be used at all.
 *
 * No allowlist means no policy, and every marketplace the user added is usable.
 * An allowlist, even an empty one, means only what it names — an organization
 * that wrote `[]` meant "none", not "no opinion".
 */
export function marketplaceAllowed(
  source: string,
  allowlist: readonly string[] | undefined,
): boolean {
  if (allowlist === undefined) return true;
  const wanted = normalizeMarketplace(source);
  return allowlist.some((allowed) => normalizeMarketplace(allowed) === wanted);
}

function joinFolder(folder: string, relative: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const base = folder.replace(/[\\/]+$/u, '');
  return `${base}${separator}${relative.split('/').join(separator)}`;
}

function urlContent(catalog: string, source: string): PluginContentLocation | undefined {
  if (!URL.canParse(source, catalog)) return undefined;
  const url = new URL(source, catalog);
  return url.protocol === 'https:' ? { kind: 'archive-url', url: url.href } : undefined;
}

/**
 * Where an entry's content lives, resolved against its marketplace.
 *
 * A URL catalog may only point at https archives. A local marketplace may only
 * point inside its own folder, so a catalog cannot name `C:\Windows` as a plugin.
 */
export function entryContentLocation(
  marketplace: MarketplaceLocation,
  entry: MarketplaceEntry,
): PluginContentLocation | undefined {
  if (marketplace.kind === 'url') return urlContent(marketplace.url, entry.source);
  if (!isContainedRelativePath(entry.source)) return undefined;
  const path = joinFolder(marketplace.path, entry.source);
  return entry.source.endsWith('.zip') ? { kind: 'archive-file', path } : { kind: 'folder', path };
}

/** The catalog's own location, for a local marketplace. */
export function catalogPath(folder: string, fileName: string): string {
  return joinFolder(folder, fileName);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The digest of a folder's content.
 *
 * Each file is fed as its path, its length and its bytes, in path order. The
 * length is what stops two files from being read as one with a different split.
 */
export function folderDigest(files: readonly PluginBundleFile[]): string {
  const hash = createHash('sha256');
  const sorted = [...files].sort((left, right) => (left.path < right.path ? -1 : 1));
  for (const file of sorted) {
    hash.update(`${file.path}\0${String(file.bytes.byteLength)}\0`);
    hash.update(file.bytes);
  }
  return hash.digest('hex');
}
