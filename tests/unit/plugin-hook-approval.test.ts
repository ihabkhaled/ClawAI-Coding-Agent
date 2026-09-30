import { describe, expect, it, vi } from 'vitest';

import {
  evaluateHookApproval,
  hookCommandLines,
  hooksDigest,
} from '../../src/core/plugin-hook-approval';
import { describeInstalled, parsePluginManifest } from '../../src/core/plugin-manifest';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

import type { PluginManifest } from '../../src/core/plugin-manifest.types';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/gu, (_match, index: string) => String(args[Number(index)])),
  },
}));

const { pluginStateDescription } = await import('../../src/services/plugin-labels');

const USER = '/profile/plugins';
const WORKSPACE = '/repo/.clawai/plugins';

function manifest(overrides: Record<string, unknown> = {}): PluginManifest {
  const parsed = parsePluginManifest(manifestJson(overrides));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.manifest;
}

function hooks(command: string) {
  return { contributes: { hooks: [{ event: 'before-tool', command, arguments: ['-x'] }] } };
}

function setup() {
  const files = new MemoryPluginFileSystem();
  const store = new PluginStore(files, { user: () => USER, workspace: () => WORKSPACE });
  return { files, store };
}

async function firstPlugin(store: PluginStore) {
  const [plugin] = (await store.list()).plugins;
  if (plugin === undefined) throw new Error('expected a plugin');
  return plugin;
}

describe('hook digest', () => {
  it('is stable, and moves with a command, an argument or the version', () => {
    const base = manifest(hooks('a.sh'));

    expect(hooksDigest(base)).toBe(hooksDigest(manifest(hooks('a.sh'))));
    expect(hooksDigest(base)).not.toBe(hooksDigest(manifest(hooks('b.sh'))));
    expect(hooksDigest(base)).not.toBe(
      hooksDigest(manifest({ ...hooks('a.sh'), version: '2.0.0' })),
    );
    expect(hookCommandLines(base)).toEqual(['a.sh -x']);
  });
});

describe('evaluateHookApproval', () => {
  const current = manifest(hooks('a.sh'));

  it('is off when nothing was approved', () => {
    expect(evaluateHookApproval(undefined, current).status).toBe('off');
    expect(evaluateHookApproval({ enabled: true, hooksEnabled: false }, current).status).toBe(
      'off',
    );
  });

  it('treats an approval with no digest as legacy, once', () => {
    const result = evaluateHookApproval({ enabled: true, hooksEnabled: true }, current);

    expect(result).toEqual({ status: 'legacy', changedCommands: ['a.sh -x'] });
  });

  it('approves only the exact digest', () => {
    const result = evaluateHookApproval(
      { enabled: true, hooksEnabled: true, hooksDigest: hooksDigest(current) },
      current,
    );

    expect(result).toEqual({ status: 'approved', changedCommands: [] });
  });

  it('names only the new commands when the digest moved', () => {
    const old = manifest(hooks('a.sh'));
    const next = manifest({
      contributes: {
        hooks: [
          { event: 'before-tool', command: 'a.sh', arguments: ['-x'] },
          { event: 'run-end', command: 'evil.sh' },
        ],
      },
    });

    const result = evaluateHookApproval(
      {
        enabled: true,
        hooksEnabled: true,
        hooksDigest: hooksDigest(old),
        approvedCommands: hookCommandLines(old),
      },
      next,
    );

    expect(result).toEqual({ status: 'changed', changedCommands: ['evil.sh'] });
  });

  it('lists every command when only the version moved', () => {
    const old = manifest(hooks('a.sh'));
    const bumped = manifest({ ...hooks('a.sh'), version: '1.0.1' });

    const result = evaluateHookApproval(
      {
        enabled: true,
        hooksEnabled: true,
        hooksDigest: hooksDigest(old),
        approvedCommands: hookCommandLines(old),
      },
      bumped,
    );

    expect(result).toEqual({ status: 'changed', changedCommands: ['a.sh -x'] });
  });
});

describe('scope defaults', () => {
  it('leaves a workspace plugin disabled and needing approval until enabled', () => {
    const workspace = describeInstalled(manifest(), 'workspace', '/w', {});
    const user = describeInstalled(manifest(), 'user', '/u', {});

    expect(workspace).toMatchObject({ enabled: false, needsApproval: true, hooksEnabled: false });
    expect(user).toMatchObject({ enabled: true, needsApproval: false });
    expect(pluginStateDescription(workspace)).toContain('Needs your approval');
  });

  it('stops needing approval once a person has chosen either way', () => {
    const on = describeInstalled(manifest(), 'workspace', '/w', {
      '/w': { enabled: true, hooksEnabled: false },
    });
    const off = describeInstalled(manifest(), 'workspace', '/w', {
      '/w': { enabled: false, hooksEnabled: false },
    });

    expect([on.needsApproval, on.enabled]).toEqual([false, true]);
    expect([off.needsApproval, off.enabled]).toEqual([false, false]);
  });
});

describe('store: approvals', () => {
  it('records the digest on approval and revokes it when the folder changes', async () => {
    const { files, store } = setup();
    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson());
    const plugin = await firstPlugin(store);

    await store.setSwitches(plugin, { enabled: true, hooksEnabled: true });
    expect((await firstPlugin(store)).hooksEnabled).toBe(true);

    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson(hooks('evil.sh')));
    const after = await firstPlugin(store);

    expect(after.hooksEnabled).toBe(false);
    expect(after.hookApproval).toEqual({ status: 'changed', changedCommands: ['evil.sh -x'] });
    expect(pluginStateDescription(after)).toContain('Hooks need re-approval');
  });

  it('lets a person approve the changed hooks again', async () => {
    const { files, store } = setup();
    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson());
    await store.setSwitches(await firstPlugin(store), { enabled: true, hooksEnabled: true });
    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson(hooks('b.sh')));

    await store.setSwitches(await firstPlugin(store), { enabled: true, hooksEnabled: true });

    expect((await firstPlugin(store)).hookApproval.status).toBe('approved');
  });

  it('migrates an approval stored without a digest to unapproved', async () => {
    const { files, store } = setup();
    files.put(`${USER}/acme.review-kit/clawai-plugin.json`, manifestJson());
    files.put(
      `${USER}/plugin-state.json`,
      JSON.stringify({ [`${USER}/acme.review-kit`]: { enabled: true, hooksEnabled: true } }),
    );

    const plugin = await firstPlugin(store);

    expect(plugin).toMatchObject({ enabled: true, hooksEnabled: false });
    expect(plugin.hookApproval.status).toBe('legacy');
    expect(pluginStateDescription(plugin)).toContain('Hooks need re-approval');
  });

  it('never approves hooks of a workspace plugin that was not enabled', async () => {
    const { files, store } = setup();
    files.put(`${WORKSPACE}/acme.review-kit/clawai-plugin.json`, manifestJson());

    const plugin = await firstPlugin(store);

    expect(plugin).toMatchObject({ scope: 'workspace', enabled: false, hooksEnabled: false });
  });
});
