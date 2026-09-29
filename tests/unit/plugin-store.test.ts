import { describe, expect, it, vi } from 'vitest';

import { PluginFailure } from '../../src/core/plugin-failure';
import { PluginSkillSource } from '../../src/services/plugin-skill-source';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

vi.mock('vscode', () => ({ Uri: {}, workspace: {}, FileType: {}, FileSystemError: Error }));

const { pluginHooks } = await import('../../src/services/workspace-plugins');

import type { SkillSourcePort } from '../../src/services/skill-catalog.types';

const USER = '/profile/plugins';
const WORKSPACE = '/repo/.clawai/plugins';

function setup(hasWorkspace = true) {
  const files = new MemoryPluginFileSystem();
  const store = new PluginStore(files, {
    user: () => USER,
    workspace: () => (hasWorkspace ? WORKSPACE : undefined),
  });
  return { files, store };
}

/** A store whose disk is gone. */
class FailingStore extends PluginStore {
  constructor() {
    super(new MemoryPluginFileSystem(), { user: () => USER, workspace: () => undefined });
  }

  override async list(): Promise<never> {
    throw new Error('disk');
  }
}

function bundle(extra: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  return Object.entries({ 'clawai-plugin.json': manifestJson(), ...extra }).map(([path, text]) => ({
    path,
    bytes: encoder.encode(text),
  }));
}

describe('PluginStore', () => {
  it('lists user and workspace plugins, and explains invalid folders', async () => {
    const { files, store } = setup();
    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson());
    files.put(`${WORKSPACE}/broken/clawai-plugin.json`, '{');
    files.put(`${WORKSPACE}/empty/readme.md`, 'x');
    files.put(`${USER}/plugin-state.json`, '{}');

    const { plugins, invalid } = await store.list();

    expect(plugins.map((plugin) => [plugin.id, plugin.scope])).toEqual([
      ['acme.review-kit', 'user'],
    ]);
    expect(invalid.map((problem) => problem.error)).toEqual([
      'clawai-plugin.json is not valid JSON',
      'clawai-plugin.json is missing',
    ]);
  });

  it('refuses an oversized manifest without parsing it', async () => {
    const { files, store } = setup(false);
    files.put(`${USER}/big/clawai-plugin.json`, ' '.repeat(70 * 1024));

    const { invalid } = await store.list();

    expect(invalid[0]?.error).toBe('clawai-plugin.json is too large');
  });

  it('installs under publisher.name, replacing an earlier version', async () => {
    const { files, store } = setup();
    files.put(`${USER}/acme.review-kit/stale.md`, 'old');

    const root = await store.install('user', bundle({ 'skills/review.md': '# review' }));

    expect(root).toBe(`${USER}/acme.review-kit`);
    expect(files.text(`${root}/skills/review.md`)).toBe('# review');
    expect(files.text(`${root}/stale.md`)).toBeUndefined();
  });

  it('refuses bundles without a valid manifest, with unsafe paths, or with no workspace', async () => {
    await expect(setup().store.install('user', [])).rejects.toMatchObject({
      code: 'invalid-manifest',
    });
    await expect(setup().store.install('user', bundle({ '../x': 'y' }))).rejects.toMatchObject({
      code: 'unsafe-path',
    });
    await expect(setup(false).store.install('workspace', bundle())).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it('stores switches in the profile and drops them on uninstall', async () => {
    const { files, store } = setup();
    await store.install('workspace', bundle());
    const [plugin] = (await store.list()).plugins;
    if (plugin === undefined) throw new Error('expected a plugin');

    await store.setSwitches(plugin, { enabled: true, hooksEnabled: true });
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(true);
    expect(files.text(`${USER}/plugin-state.json`)).toContain(plugin.root);

    await store.uninstall(plugin);
    expect((await store.list()).plugins).toEqual([]);
    expect(files.text(`${USER}/plugin-state.json`)).toBe('{}\n');
  });

  it('treats a damaged switch file as defaults', async () => {
    const { files, store } = setup();
    files.put(`${USER}/plugin-state.json`, 'not json');
    await store.install('user', bundle());

    expect((await store.list()).plugins[0]).toMatchObject({ enabled: true, hooksEnabled: false });
  });

  it('reads a folder tree with relative paths, bounded in size', async () => {
    const { files, store } = setup();
    files.put('/src/kit/a.md', 'a');
    files.put('/src/kit/nested/b.md', 'b');

    const tree = await store.readTree('/src/kit');

    expect(tree.map((file) => file.path).sort()).toEqual(['a.md', 'nested/b.md']);

    files.put('/src/huge/big.bin', 'x'.repeat(11 * 1024 * 1024));
    await expect(store.readTree('/src/huge')).rejects.toBeInstanceOf(PluginFailure);
  });

  it('refuses a folder nested too deep', async () => {
    const { files, store } = setup();
    files.put(`/deep/${Array.from({ length: 10 }, () => 'd').join('/')}/x.md`, 'x');

    await expect(store.readTree('/deep')).rejects.toMatchObject({ code: 'too-large' });
  });

  it('reads only small Markdown files from a contributed folder', async () => {
    const { files, store } = setup();
    files.put('/p/skills/review.md', '# review');
    files.put('/p/skills/notes.txt', 'no');
    files.put('/p/skills/big.md', 'x'.repeat(200 * 1024));
    files.put('/p/skills/sub/deeper.md', 'no');

    expect(await store.markdownFiles('/p', 'skills')).toEqual([
      { fileName: 'review.md', content: '# review' },
    ]);
  });
});

describe('PluginSkillSource', () => {
  const base: SkillSourcePort = {
    global: async () => [{ fileName: 'mine.md', content: 'user' }],
    project: async () => [{ fileName: 'repo.md', content: 'repo' }],
  };

  it('puts plugin files before the user and project files of each scope', async () => {
    const { files, store } = setup();
    await store.install('user', bundle({ 'skills/review.md': 'plugin skill' }));
    files.put(`${WORKSPACE}/acme.review-kit/clawai-plugin.json`, manifestJson());
    files.put(`${WORKSPACE}/acme.review-kit/commands/ship.md`, 'plugin command');
    const source = new PluginSkillSource(base, store, ['skills', 'commands']);

    expect(await source.global()).toEqual([
      { fileName: 'review.md', content: 'plugin skill' },
      { fileName: 'mine.md', content: 'user' },
    ]);
    expect(await source.project()).toEqual([
      { fileName: 'ship.md', content: 'plugin command' },
      { fileName: 'repo.md', content: 'repo' },
    ]);
  });

  it('contributes nothing when plugins cannot be read', async () => {
    const source = new PluginSkillSource(base, new FailingStore(), ['skills']);

    expect(await source.global()).toEqual([{ fileName: 'mine.md', content: 'user' }]);
  });
});

describe('pluginHooks', () => {
  it('returns hooks of plugins whose hooks were switched on', async () => {
    const { store } = setup();
    await store.install('user', bundle());
    const [plugin] = (await store.list()).plugins;
    if (plugin === undefined) throw new Error('expected a plugin');
    expect(await pluginHooks(store)).toEqual([]);

    await store.setSwitches(plugin, { enabled: true, hooksEnabled: true });

    expect(await pluginHooks(store)).toEqual([
      expect.objectContaining({ command: `${plugin.root}/guard.sh` }),
    ]);
  });

  it('returns nothing when plugins cannot be read', async () => {
    expect(await pluginHooks(new FailingStore())).toEqual([]);
  });
});
