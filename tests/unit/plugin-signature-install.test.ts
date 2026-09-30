import { generateKeyPairSync, sign } from 'node:crypto';

import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../../src/core/plugin-marketplace';
import { canonicalEntryJson } from '../../src/core/plugin-signature';
import { unzipPlugin } from '../../src/infrastructure/plugin-archive';
import { PluginMarketplaceService } from '../../src/services/plugin-marketplace-service';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

import type { MarketplaceEntry } from '../../src/core/plugin-marketplace.types';
import type { PluginSignatureSettings } from '../../src/core/plugin-signature.types';

const CATALOG_URL = 'https://market.example/catalog.json';

async function archive(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('clawai-plugin.json', manifestJson());
  return zip.generateAsync({ type: 'uint8array' });
}

async function fixture(mode: PluginSignatureSettings['mode'], trust: boolean, tamper = false) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const bytes = await archive();
  const base: MarketplaceEntry = {
    name: 'review-kit',
    publisher: 'acme',
    version: '1.0.0',
    description: '',
    source: 'review-kit.zip',
    sha256: sha256Hex(bytes),
  };
  const signature = sign(null, Buffer.from(canonicalEntryJson(base), 'utf8'), privateKey).toString(
    'base64',
  );
  const listed = { ...base, signature };
  const files = new MemoryPluginFileSystem();
  const store = new PluginStore(files, { user: () => '/profile/plugins', workspace: () => '/w' });
  const download = vi.fn(async (url: string) =>
    url === CATALOG_URL
      ? new TextEncoder().encode(JSON.stringify({ name: 'Acme', plugins: [listed] }))
      : bytes,
  );
  const onUnverified = vi.fn();
  const service = new PluginMarketplaceService({
    store,
    files,
    download,
    unzip: unzipPlugin,
    allowlist: async () => undefined,
    signatures: async () => ({
      mode,
      trusted: trust
        ? { acme: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }
        : {},
    }),
    onUnverified,
  });
  const opened = await service.open(CATALOG_URL);
  // A signed field changes after signing; the pinned digest still matches the bytes.
  const entry = tamper ? { ...listed, source: 'review-kit.zip ' } : listed;
  return { service, store, opened, entry, download, onUnverified };
}

describe('plugin signature at install', () => {
  it('installs a valid signature silently and records who signed it', async () => {
    const { service, store, opened, entry, onUnverified } = await fixture('require', true);

    await service.install(opened, entry, 'user');

    expect(onUnverified).not.toHaveBeenCalled();
    expect((await store.list()).plugins[0]?.signature).toEqual({ signedBy: 'acme' });
  });

  it('refuses an unknown publisher in require mode before downloading the plugin', async () => {
    const { service, store, opened, entry, download } = await fixture('require', false);
    download.mockClear();

    await expect(service.install(opened, entry, 'user')).rejects.toMatchObject({
      code: 'signature-rejected',
    });
    expect(download).not.toHaveBeenCalled();
    expect((await store.list()).plugins).toEqual([]);
  });

  it('refuses a tampered entry in require mode', async () => {
    const { service, opened, entry } = await fixture('require', true, true);

    await expect(service.install(opened, entry, 'user')).rejects.toMatchObject({
      code: 'signature-rejected',
      detail: 'acme.review-kit: invalid',
    });
  });

  it('installs an unverified plugin in warn mode, warns, and records it unsigned', async () => {
    const { service, store, opened, entry, onUnverified } = await fixture('warn', false);

    await service.install(opened, entry, 'user');

    expect(onUnverified).toHaveBeenCalledWith(entry, { status: 'unknown-publisher' });
    expect((await store.list()).plugins[0]?.signature).toEqual({});
  });

  it('does not check anything when off', async () => {
    const { service, opened, entry, onUnverified } = await fixture('off', false, true);

    await expect(service.install(opened, entry, 'user')).resolves.toContain('acme.review-kit');
    expect(onUnverified).not.toHaveBeenCalled();
  });

  it('forgets the provenance when a plugin is uninstalled', async () => {
    const { service, store, opened, entry } = await fixture('warn', true);
    await service.install(opened, entry, 'user');
    const plugin = (await store.list()).plugins[0];
    if (plugin === undefined) throw new Error('not installed');

    await store.uninstall(plugin);

    expect(await store.list()).toEqual({ plugins: [], invalid: [] });
  });
});
