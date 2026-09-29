import { describe, expect, it } from 'vitest';

import {
  catalogPath,
  entryContentLocation,
  folderDigest,
  marketplaceAllowed,
  marketplaceLocation,
  sha256Hex,
} from '../../src/core/plugin-marketplace';

import type { MarketplaceEntry } from '../../src/core/plugin-marketplace.types';

function entry(source: string): MarketplaceEntry {
  return {
    name: 'kit',
    publisher: 'acme',
    version: '1.0.0',
    description: '',
    source,
    sha256: 'a'.repeat(64),
  };
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('marketplaceLocation', () => {
  it('accepts https and absolute folders', () => {
    expect(marketplaceLocation(' https://example.com/m.json ')).toEqual({
      kind: 'url',
      url: 'https://example.com/m.json',
    });
    expect(marketplaceLocation('/srv/market')).toEqual({ kind: 'folder', path: '/srv/market' });
    expect(marketplaceLocation('D:\\market')).toEqual({ kind: 'folder', path: 'D:\\market' });
  });

  it('refuses plain http, relative folders and broken URLs', () => {
    expect(marketplaceLocation('http://example.com/m.json')).toBeUndefined();
    expect(marketplaceLocation('market')).toBeUndefined();
    expect(marketplaceLocation('https://')).toBeUndefined();
  });
});

describe('marketplaceAllowed', () => {
  it('allows everything without a policy', () => {
    expect(marketplaceAllowed('https://a.example/m.json', undefined)).toBe(true);
  });

  it('allows only what the allowlist names, ignoring trailing slashes', () => {
    expect(marketplaceAllowed('https://a.example/m/', ['https://a.example/m'])).toBe(true);
    expect(marketplaceAllowed('https://b.example/m', ['https://a.example/m'])).toBe(false);
    expect(marketplaceAllowed('https://a.example/m', [])).toBe(false);
  });
});

describe('entryContentLocation', () => {
  const url = { kind: 'url', url: 'https://example.com/market/catalog.json' } as const;
  const folder = { kind: 'folder', path: '/srv/market/' } as const;

  it('resolves relative archive URLs against the catalog', () => {
    expect(entryContentLocation(url, entry('kit.zip'))).toEqual({
      kind: 'archive-url',
      url: 'https://example.com/market/kit.zip',
    });
  });

  it('refuses a non-https or unparsable archive URL', () => {
    expect(entryContentLocation(url, entry('http://evil.example/kit.zip'))).toBeUndefined();
    expect(entryContentLocation(url, entry('https://['))).toBeUndefined();
  });

  it('keeps local sources inside the marketplace folder', () => {
    expect(entryContentLocation(folder, entry('plugins/kit'))).toEqual({
      kind: 'folder',
      path: '/srv/market/plugins/kit',
    });
    expect(entryContentLocation(folder, entry('kit.zip'))).toEqual({
      kind: 'archive-file',
      path: '/srv/market/kit.zip',
    });
    expect(entryContentLocation(folder, entry('../etc'))).toBeUndefined();
  });

  it('uses the separator a Windows path already has', () => {
    expect(catalogPath('D:\\market', 'a/b.json')).toBe('D:\\market\\a\\b.json');
  });
});

describe('digests', () => {
  it('hashes bytes as sha256 hex', () => {
    expect(sha256Hex(bytes(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is independent of file order and sensitive to the split between files', () => {
    const one = folderDigest([
      { path: 'a', bytes: bytes('xy') },
      { path: 'b', bytes: bytes('z') },
    ]);
    const reordered = folderDigest([
      { path: 'b', bytes: bytes('z') },
      { path: 'a', bytes: bytes('xy') },
    ]);
    const resplit = folderDigest([
      { path: 'a', bytes: bytes('x') },
      { path: 'b', bytes: bytes('yz') },
    ]);

    expect(reordered).toBe(one);
    expect(resplit).not.toBe(one);
  });
});
