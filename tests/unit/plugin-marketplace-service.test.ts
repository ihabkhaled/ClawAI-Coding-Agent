import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { folderDigest, sha256Hex } from '../../src/core/plugin-marketplace';
import { unzipPlugin } from '../../src/infrastructure/plugin-archive';
import { downloadBytes } from '../../src/infrastructure/plugin-download';
import { PluginMarketplaceService } from '../../src/services/plugin-marketplace-service';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

import type { MarketplaceEntry } from '../../src/core/plugin-marketplace.types';

const CATALOG_URL = 'https://market.example/catalog.json';
const encoder = new TextEncoder();

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const archive = new JSZip();
  for (const [path, text] of Object.entries(files)) archive.file(path, text);
  return archive.generateAsync({ type: 'uint8array' });
}

function entry(overrides: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    name: 'review-kit',
    publisher: 'acme',
    version: '1.0.0',
    description: 'Review helpers',
    source: 'review-kit.zip',
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function setup(
  options: { allowlist?: readonly string[]; downloads?: Record<string, Uint8Array> } = {},
) {
  const files = new MemoryPluginFileSystem();
  const store = new PluginStore(files, { user: () => '/profile/plugins', workspace: () => '/w' });
  const download = vi.fn(async (url: string) => {
    const bytes = options.downloads?.[url];
    if (bytes === undefined) throw new Error(`unexpected ${url}`);
    return bytes;
  });
  const unzip = vi.fn(unzipPlugin);
  const service = new PluginMarketplaceService({
    store,
    files,
    download,
    unzip,
    allowlist: async () => options.allowlist,
  });
  return { files, store, service, download, unzip };
}

function catalog(plugins: MarketplaceEntry[]): Uint8Array {
  return encoder.encode(JSON.stringify({ name: 'Acme', plugins }));
}

describe('PluginMarketplaceService', () => {
  it('opens a URL catalog and installs a verified archive', async () => {
    const archive = await zip({
      'review-kit-1.0.0/clawai-plugin.json': manifestJson(),
      'review-kit-1.0.0/skills/review.md': '# review',
    });
    const pinned = entry({ sha256: sha256Hex(archive) });
    const { service, files } = setup({
      downloads: {
        [CATALOG_URL]: catalog([pinned]),
        'https://market.example/review-kit.zip': archive,
      },
    });

    const opened = await service.open(CATALOG_URL);
    const root = await service.install(opened, pinned, 'user');

    expect(opened.catalog.plugins).toHaveLength(1);
    expect(root).toBe('/profile/plugins/acme.review-kit');
    expect(files.text(`${root}/skills/review.md`)).toBe('# review');
  });

  it('never unpacks an archive whose digest does not match', async () => {
    const archive = await zip({ 'clawai-plugin.json': manifestJson() });
    const { service, unzip, files } = setup({
      downloads: {
        [CATALOG_URL]: catalog([entry()]),
        'https://market.example/review-kit.zip': archive,
      },
    });
    const opened = await service.open(CATALOG_URL);

    await expect(service.install(opened, entry(), 'user')).rejects.toMatchObject({
      code: 'digest-mismatch',
    });
    expect(unzip).not.toHaveBeenCalled();
    expect(files.files.size).toBe(0);
  });

  it('refuses a plugin whose manifest is not the entry it was listed as', async () => {
    const archive = await zip({ 'clawai-plugin.json': manifestJson({ version: '2.0.0' }) });
    const pinned = entry({ sha256: sha256Hex(archive) });
    const { service } = setup({
      downloads: {
        [CATALOG_URL]: catalog([pinned]),
        'https://market.example/review-kit.zip': archive,
      },
    });

    await expect(
      service.install(await service.open(CATALOG_URL), pinned, 'user'),
    ).rejects.toMatchObject({ code: 'name-mismatch' });
  });

  it('refuses a bundle without a valid manifest', async () => {
    const archive = await zip({ 'readme.md': 'x' });
    const pinned = entry({ sha256: sha256Hex(archive) });
    const { service } = setup({
      downloads: {
        [CATALOG_URL]: catalog([pinned]),
        'https://market.example/review-kit.zip': archive,
      },
    });

    await expect(
      service.install(await service.open(CATALOG_URL), pinned, 'user'),
    ).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it('installs a verified folder from a local marketplace', async () => {
    const { service, files } = setup();
    files.put('/market/clawai-marketplace.json', '');
    files.put('/market/kits/review/clawai-plugin.json', manifestJson());
    const digest = folderDigest([
      { path: 'clawai-plugin.json', bytes: encoder.encode(manifestJson()) },
    ]);
    const pinned = entry({ source: 'kits/review', sha256: digest });
    files.files.set('/market/clawai-marketplace.json', catalog([pinned]));

    const root = await service.install(await service.open('/market'), pinned, 'workspace');

    expect(root).toBe('/w/acme.review-kit');
    await expect(
      service.install(await service.open('/market'), { ...pinned, sha256: 'b'.repeat(64) }, 'user'),
    ).rejects.toMatchObject({ code: 'digest-mismatch' });
  });

  it('verifies a local archive by its bytes', async () => {
    const archive = await zip({ 'clawai-plugin.json': manifestJson() });
    const pinned = entry({ sha256: sha256Hex(archive) });
    const { service, files } = setup();
    files.files.set('/market/clawai-marketplace.json', catalog([pinned]));
    files.files.set('/market/review-kit.zip', archive);

    await expect(service.install(await service.open('/market'), pinned, 'user')).resolves.toBe(
      '/profile/plugins/acme.review-kit',
    );
    await expect(
      service.install(await service.open('/market'), { ...pinned, source: 'gone.zip' }, 'user'),
    ).rejects.toMatchObject({ code: 'unreachable' });
    await expect(
      service.install(await service.open('/market'), { ...pinned, source: '../x' }, 'user'),
    ).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('refuses marketplaces policy does not list, and unusable locations', async () => {
    await expect(
      setup({ allowlist: ['https://other.example'] }).service.open(CATALOG_URL),
    ).rejects.toMatchObject({ code: 'not-allowed' });
    await expect(setup().service.open('http://market.example')).rejects.toMatchObject({
      code: 'invalid-source',
    });
    await expect(setup().service.open('/missing')).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('re-checks policy at install time', async () => {
    const allowlist: string[] = [CATALOG_URL];
    const { service } = setup({ allowlist, downloads: { [CATALOG_URL]: catalog([entry()]) } });
    const opened = await service.open(CATALOG_URL);
    allowlist.pop();

    await expect(service.install(opened, entry(), 'user')).rejects.toMatchObject({
      code: 'not-allowed',
    });
  });

  it('refuses catalogs that are not JSON or do not match the schema', async () => {
    const broken = setup({ downloads: { [CATALOG_URL]: encoder.encode('{') } });
    const wrong = setup({ downloads: { [CATALOG_URL]: encoder.encode('{"plugins":1}') } });

    await expect(broken.service.open(CATALOG_URL)).rejects.toMatchObject({
      code: 'invalid-catalog',
    });
    await expect(wrong.service.open(CATALOG_URL)).rejects.toMatchObject({
      code: 'invalid-catalog',
    });
  });

  it('clones a git marketplace and installs from it by digest, like a folder', async () => {
    const { files, store } = setup();
    const source = 'git+https://git.example/market.git#v1';
    files.put('/clones/abc/kits/review/clawai-plugin.json', manifestJson());
    const digest = folderDigest([
      { path: 'clawai-plugin.json', bytes: encoder.encode(manifestJson()) },
    ]);
    const pinned = entry({ source: 'kits/review', sha256: digest });
    files.files.set('/clones/abc/clawai-marketplace.json', catalog([pinned]));
    const cloneGit = vi.fn(async () => '/clones/abc');
    const service = new PluginMarketplaceService({
      store,
      files,
      download: vi.fn(),
      unzip: unzipPlugin,
      cloneGit,
      allowlist: async () => [source],
    });

    const opened = await service.open(source);

    expect(cloneGit).toHaveBeenCalledWith({
      kind: 'git',
      url: 'https://git.example/market.git',
      ref: 'v1',
    });
    expect(opened.location).toEqual({ kind: 'folder', path: '/clones/abc' });
    await expect(service.install(opened, pinned, 'user')).resolves.toBe(
      '/profile/plugins/acme.review-kit',
    );
    await expect(
      service.install(opened, { ...pinned, sha256: 'b'.repeat(64) }, 'user'),
    ).rejects.toMatchObject({ code: 'digest-mismatch' });
  });

  it('refuses a git marketplace where no clone can run, or policy does not list it', async () => {
    await expect(setup().service.open('git+https://git.example/market.git')).rejects.toMatchObject({
      code: 'invalid-source',
    });
    await expect(
      setup({ allowlist: ['https://other'] }).service.open('git+https://git.example/market.git'),
    ).rejects.toMatchObject({ code: 'not-allowed' });
  });

  it('installs a folder the user picked without a digest', async () => {
    const { service, files } = setup();
    files.put('/picked/clawai-plugin.json', manifestJson());

    await expect(service.installFolder('/picked', 'user')).resolves.toBe(
      '/profile/plugins/acme.review-kit',
    );
  });
});

describe('unzipPlugin', () => {
  it('refuses bytes that are not a zip', async () => {
    await expect(unzipPlugin(encoder.encode('nope'))).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('refuses an entry that escapes the plugin', async () => {
    const archive = new JSZip();
    archive.file('ok.md', 'x');
    archive.file('..\\evil.md', 'x');

    await expect(
      unzipPlugin(await archive.generateAsync({ type: 'uint8array' })),
    ).rejects.toMatchObject({ code: 'unsafe-path' });
  });

  it('refuses an archive with too many files', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 501 }, (_, index) => [`f${String(index)}.md`, 'x']),
    );

    await expect(unzipPlugin(await zip(files))).rejects.toMatchObject({ code: 'too-large' });
  });
});

const PUBLIC = { lookup: async () => ['93.184.216.34'] };

describe('downloadBytes', () => {
  function response(body: string, init: { status?: number; url?: string; length?: string } = {}) {
    const headers = new Headers(init.length === undefined ? {} : { 'content-length': init.length });
    const result = new Response(body, { status: init.status ?? 200, headers });
    Object.defineProperty(result, 'url', { value: init.url ?? 'https://a.example/x' });
    return result;
  }

  it('returns the bytes of an https download', async () => {
    const bytes = await downloadBytes('https://a.example/x', async () => response('hi'), PUBLIC);

    expect(new TextDecoder().decode(bytes)).toBe('hi');
  });

  it('refuses http, failures, redirects to http and oversized bodies', async () => {
    await expect(downloadBytes('http://a.example/x')).rejects.toMatchObject({
      code: 'invalid-source',
    });
    await expect(
      downloadBytes(
        'https://a.example/x',
        async () => Promise.reject(new Error('offline')),
        PUBLIC,
      ),
    ).rejects.toMatchObject({ code: 'unreachable' });
    await expect(
      downloadBytes('https://a.example/x', async () => response('', { status: 404 }), PUBLIC),
    ).rejects.toMatchObject({ code: 'unreachable' });
    await expect(
      downloadBytes(
        'https://a.example/x',
        async () => response('', { url: 'http://a.example/x' }),
        PUBLIC,
      ),
    ).rejects.toMatchObject({ code: 'invalid-source' });
    await expect(
      downloadBytes(
        'https://a.example/x',
        async () => response('', { length: '99999999' }),
        PUBLIC,
      ),
    ).rejects.toMatchObject({ code: 'too-large' });
  });
});
