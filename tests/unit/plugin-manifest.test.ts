import { describe, expect, it, vi } from 'vitest';

import { PluginFailure } from '../../src/core/plugin-failure';
import { hookCommandLines, hooksDigest } from '../../src/core/plugin-hook-approval';
import {
  contributionFolders,
  describeInstalled,
  enabledPluginHooks,
  manifestInBundle,
  parsePluginManifest,
  pluginId,
} from '../../src/core/plugin-manifest';
import { isContainedRelativePath, stripSharedTopFolder } from '../../src/core/plugin-path';
import { LifecycleHookService } from '../../src/services/lifecycle-hook-service';
import { manifestJson } from '../helpers/memory-plugin-file-system';

import type { PluginManifest } from '../../src/core/plugin-manifest.types';

function manifest(overrides: Record<string, unknown> = {}): PluginManifest {
  const parsed = parsePluginManifest(manifestJson(overrides));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.manifest;
}

function approved() {
  return {
    enabled: true,
    hooksEnabled: true,
    hooksDigest: hooksDigest(manifest()),
    approvedCommands: hookCommandLines(manifest()),
  };
}

describe('parsePluginManifest', () => {
  it('reads a full manifest and fills defaults', () => {
    const parsed = manifest({ contributes: undefined, description: undefined });

    expect(parsed.description).toBe('');
    expect(parsed.contributes).toMatchObject({ skills: [], hooks: [], mcpServers: {} });
    expect(pluginId(parsed)).toBe('acme.review-kit');
  });

  it('refuses text that is not JSON', () => {
    expect(parsePluginManifest('{')).toEqual({
      ok: false,
      error: 'clawai-plugin.json is not valid JSON',
    });
  });

  it('names the failing field', () => {
    const parsed = parsePluginManifest(manifestJson({ version: 'one' }));

    expect(parsed).toMatchObject({ ok: false, error: expect.stringContaining('version: ') });
  });

  it('refuses a contribution path that escapes the plugin', () => {
    const parsed = parsePluginManifest(manifestJson({ contributes: { skills: ['../outside'] } }));

    expect(parsed.ok).toBe(false);
  });

  it('refuses an MCP server declaring both or neither of command and url', () => {
    const both = { docs: { command: 'x', url: 'https://example.com' } };
    const neither = { docs: {} };

    expect(parsePluginManifest(manifestJson({ contributes: { mcpServers: both } })).ok).toBe(false);
    expect(parsePluginManifest(manifestJson({ contributes: { mcpServers: neither } })).ok).toBe(
      false,
    );
  });

  it('reports a top-level issue without a path prefix', () => {
    const parsed = parsePluginManifest('[]');

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.error).not.toContain(': :');
  });
});

describe('plugin switches and contributions', () => {
  it('defaults to enabled with hooks off', () => {
    const plugin = describeInstalled(manifest(), 'user', '/p/acme.review-kit', {});

    expect(plugin).toMatchObject({ id: 'acme.review-kit', enabled: true, hooksEnabled: false });
  });

  it('keeps hooks off while the plugin is disabled', () => {
    const plugin = describeInstalled(manifest(), 'user', '/p', {
      '/p': { enabled: false, hooksEnabled: true },
    });

    expect(plugin.hooksEnabled).toBe(false);
  });

  it('lists folders of enabled plugins of one scope only', () => {
    const on = describeInstalled(manifest(), 'user', '/a', {});
    const off = describeInstalled(manifest(), 'user', '/b', {
      '/b': { enabled: false, hooksEnabled: false },
    });
    const workspace = describeInstalled(manifest(), 'workspace', '/c', {
      '/c': { enabled: true, hooksEnabled: false },
    });

    expect(contributionFolders([on, off, workspace], 'skills', 'user')).toEqual([
      { root: '/a', folder: 'skills' },
    ]);
  });

  it('substitutes the plugin root into hooks that were switched on', () => {
    const on = describeInstalled(manifest(), 'user', '/a', {
      '/a': approved(),
    });
    const off = describeInstalled(manifest(), 'user', '/b', {});

    expect(enabledPluginHooks([on, off])).toEqual([
      expect.objectContaining({ command: '/a/guard.sh', arguments: ['/a'] }),
    ]);
  });

  it('reads the manifest out of a bundle', () => {
    const bytes = new TextEncoder().encode(manifestJson());

    expect(manifestInBundle([{ path: 'clawai-plugin.json', bytes }]).ok).toBe(true);
    expect(manifestInBundle([])).toEqual({ ok: false, error: 'clawai-plugin.json is missing' });
  });

  it('lets the hook service read hooks asynchronously, as plugin hooks are', async () => {
    const run = vi.fn(async () => ({ exitCode: 1, timedOut: false }));
    const hooks = enabledPluginHooks([
      describeInstalled(manifest(), 'user', '/a', { '/a': approved() }),
    ]).map((hook) => ({ ...hook, blocking: true }));
    const service = new LifecycleHookService({
      runner: { run },
      hooks: async () => hooks,
      trusted: () => true,
      log: vi.fn(),
    });

    await expect(service.run('before-tool', 'workspace.files')).resolves.toEqual({
      blocked: true,
      reason: 'refused',
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ command: '/a/guard.sh' }),
      undefined,
    );
  });
});

describe('plugin paths', () => {
  it.each(['skills', 'a/b.md'])('accepts %s', (path) => {
    expect(isContainedRelativePath(path)).toBe(true);
  });

  it.each(['', '/etc', 'C:/x', 'a\\b', '../x', 'a//b', 'a/../b', 'a\0b'])('refuses %j', (path) => {
    expect(isContainedRelativePath(path)).toBe(false);
  });

  it('strips one shared wrapping folder', () => {
    expect(stripSharedTopFolder(['kit/a', 'kit/b/c'])).toEqual(['a', 'b/c']);
    expect(stripSharedTopFolder(['kit/a', 'other/b'])).toEqual(['kit/a', 'other/b']);
    expect(stripSharedTopFolder([])).toEqual([]);
  });

  it('carries a code and detail on a failure', () => {
    expect(new PluginFailure('too-large').message).toBe('too-large');
    expect(new PluginFailure('unsafe-path', 'x').message).toBe('unsafe-path: x');
  });
});
