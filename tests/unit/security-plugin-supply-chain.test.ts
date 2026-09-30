import { Readable } from 'node:stream';

import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isContainedRelativePath } from '../../src/core/plugin-path';
import { unzipPlugin } from '../../src/infrastructure/plugin-archive';
import { downloadBytes } from '../../src/infrastructure/plugin-download';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

const USER = '/profile/plugins';
const MEGABYTE = 1024 * 1024;
const PUBLIC = { lookup: async () => ['93.184.216.34'] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('zip bombs are stopped while they inflate, not after', () => {
  it('never materialises an entry whose inflated size passes the ceiling', async () => {
    let produced = 0;
    const source = new Readable({
      read() {
        produced += 1;
        this.push(produced > 1_000 ? null : Buffer.alloc(MEGABYTE));
      },
    });
    const bomb = {
      name: 'bomb.txt',
      dir: false,
      async: () => Promise.reject(new Error('whole-entry inflate is not allowed')),
      nodeStream: () => source,
    };
    vi.spyOn(JSZip, 'loadAsync').mockResolvedValue({ files: { 'bomb.txt': bomb } } as never);

    await expect(unzipPlugin(new Uint8Array([1]))).rejects.toMatchObject({ code: 'too-large' });
    expect(produced).toBeLessThan(40);
    expect(source.destroyed).toBe(true);
  });

  it('still unpacks an ordinary archive', async () => {
    const zip = new JSZip();
    zip.file('plugin/clawai-plugin.json', manifestJson());
    zip.file('plugin/skills/a.md', '# a');
    const files = await unzipPlugin(await zip.generateAsync({ type: 'uint8array' }));
    expect(files.map((file) => file.path).sort()).toEqual(['clawai-plugin.json', 'skills/a.md']);
  });
});

describe('downloads', () => {
  function streamed(chunks: number, counter: { pulled: number }): Response {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        counter.pulled += 1;
        if (sent >= chunks) controller.close();
        else controller.enqueue(new Uint8Array(MEGABYTE));
        sent += 1;
      },
    });
    return new Response(body, { status: 200 });
  }

  it('stops reading a body with no content-length once it passes the ceiling', async () => {
    const counter = { pulled: 0 };
    const request = vi.fn(async () => streamed(500, counter));
    await expect(downloadBytes('https://cdn.example/p.zip', request, PUBLIC)).rejects.toMatchObject(
      {
        code: 'too-large',
      },
    );
    expect(counter.pulled).toBeLessThan(30);
  });

  it.each(['https://user:pass@cdn.example/p.zip', 'https://token@cdn.example/p.zip'])(
    'refuses credentials in the URL: %s',
    async (url) => {
      const request = vi.fn();
      await expect(downloadBytes(url, request, PUBLIC)).rejects.toMatchObject({
        code: 'invalid-source',
      });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it('still returns a small body', async () => {
    const request = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    expect([...(await downloadBytes('https://cdn.example/p.zip', request, PUBLIC))]).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('plugin paths', () => {
  it.each(['a:stream', 'dir/file.txt:hidden', 'C:evil'])(
    'refuses an NTFS stream or drive form: %s',
    (path) => {
      expect(isContainedRelativePath(path)).toBe(false);
    },
  );
  it('keeps ordinary nested paths', () => {
    expect(isContainedRelativePath('skills/a.md')).toBe(true);
  });
});

describe('an update never carries the old hooks approval', () => {
  it('re-installing an update with different hooks switches hooks off but keeps enabled', async () => {
    const files = new MemoryPluginFileSystem();
    const store = new PluginStore(files, { user: () => USER, workspace: () => undefined });
    const bundle = [
      { path: 'clawai-plugin.json', bytes: new TextEncoder().encode(manifestJson()) },
    ];
    await store.install('user', bundle);
    const [installed] = (await store.list()).plugins;
    if (installed === undefined) throw new Error('expected a plugin');
    await store.setSwitches(installed, { enabled: true, hooksEnabled: true });
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(true);

    const changed = [
      {
        path: 'clawai-plugin.json',
        bytes: new TextEncoder().encode(manifestJson({ version: '1.0.1' })),
      },
    ];
    await store.install('user', changed);

    const [updated] = (await store.list()).plugins;
    expect(updated?.hooksEnabled).toBe(false);
    expect(updated?.enabled).toBe(true);
  });
});
