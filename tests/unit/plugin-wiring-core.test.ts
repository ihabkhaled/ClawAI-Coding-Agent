import { describe, expect, it } from 'vitest';

import { mergeSubAgentDefinitions, pluginAgentDefinition } from '../../src/core/plugin-agents';
import {
  gitCloneArguments,
  gitCloneFolderName,
  gitMarketplaceLocation,
} from '../../src/core/plugin-git-marketplace';
import { describeInstalled, parsePluginManifest } from '../../src/core/plugin-manifest';
import { marketplaceLocation } from '../../src/core/plugin-marketplace';
import {
  effectiveMarketplaceAllowlist,
  readOrganizationMarketplaceAllowlist,
} from '../../src/core/plugin-marketplace-policy';
import { pluginMcpServers } from '../../src/core/plugin-mcp';

import type { InstalledPlugin } from '../../src/core/plugin-manifest.types';

function plugin(
  contributes: Record<string, unknown>,
  options: { enabled?: boolean; publisher?: string } = {},
): InstalledPlugin {
  const parsed = parsePluginManifest(
    JSON.stringify({
      name: 'kit',
      publisher: options.publisher ?? 'acme',
      version: '1.0.0',
      contributes,
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return describeInstalled(parsed.manifest, 'user', '/plugins/acme.kit', {
    '/plugins/acme.kit': { enabled: options.enabled ?? true, hooksEnabled: false },
  });
}

describe('git marketplaces', () => {
  it('reads git+https with and without a ref', () => {
    expect(gitMarketplaceLocation('git+https://git.example/m.git#v1.2')).toEqual({
      kind: 'git',
      url: 'https://git.example/m.git',
      ref: 'v1.2',
    });
    expect(marketplaceLocation(' git+https://git.example/m.git ')).toEqual({
      kind: 'git',
      url: 'https://git.example/m.git',
    });
  });

  it('refuses other schemes, credentials, queries, unparsable URLs and option-like refs', () => {
    for (const source of [
      'git+http://git.example/m.git',
      'git+ssh://git@git.example/m.git',
      'git+https://user:secret@git.example/m.git',
      'git+https://git.example/m.git?x=1',
      'git+https://',
      'git+https://git.example/m.git#--upload-pack=evil',
      'git+https://git.example/m.git#a..b',
      'git+https://git.example/m.git#main.lock',
      'git+https://git.example/m.git#',
    ]) {
      expect(marketplaceLocation(source), source).toBeUndefined();
    }
  });

  it('names the clone folder stably per URL and ref', () => {
    const one = gitCloneFolderName({ kind: 'git', url: 'https://g/m.git', ref: 'main' });
    expect(one).toMatch(/^[a-f0-9]{24}$/u);
    expect(gitCloneFolderName({ kind: 'git', url: 'https://g/m.git', ref: 'main' })).toBe(one);
    expect(gitCloneFolderName({ kind: 'git', url: 'https://g/m.git' })).not.toBe(one);
  });

  it('builds a shallow, shell-free clone argv that ends options before the URL', () => {
    const withRef = gitCloneArguments({ kind: 'git', url: 'https://g/m.git', ref: 'v1' }, '/c');
    expect(withRef).toContain('protocol.file.allow=never');
    expect(withRef.slice(-5)).toEqual(['--branch', 'v1', '--', 'https://g/m.git', '/c']);
    expect(gitCloneArguments({ kind: 'git', url: 'https://g/m.git' }, '/c')).not.toContain(
      '--branch',
    );
  });
});

describe('marketplace allowlist policy', () => {
  it('reads the organization list, and a malformed one as refusing everything', () => {
    expect(readOrganizationMarketplaceAllowlist(undefined)).toBeUndefined();
    expect(readOrganizationMarketplaceAllowlist(null)).toBeUndefined();
    expect(readOrganizationMarketplaceAllowlist(['https://m'])).toEqual(['https://m']);
    expect(readOrganizationMarketplaceAllowlist('https://m')).toEqual([]);
  });

  it('lets the organization win and the project only narrow it', () => {
    expect(effectiveMarketplaceAllowlist(undefined, undefined)).toBeUndefined();
    expect(effectiveMarketplaceAllowlist(undefined, ['p'])).toEqual(['p']);
    expect(effectiveMarketplaceAllowlist(['o'], undefined)).toEqual(['o']);
    expect(effectiveMarketplaceAllowlist(['o', 'shared/'], ['shared', 'p'])).toEqual(['shared/']);
  });
});

describe('pluginMcpServers', () => {
  it('namespaces servers of enabled plugins and substitutes the plugin root', () => {
    const load = pluginMcpServers([
      plugin({
        mcpServers: {
          docs: { command: '${pluginRoot}/bin/docs', args: ['--root', '${pluginRoot}'] },
          web: { url: 'https://mcp.example/sse' },
        },
      }),
    ]);
    expect(load.errors).toEqual([]);
    expect(load.servers).toEqual([
      {
        name: 'acme.kit.docs',
        origin: 'plugin',
        transport: 'stdio',
        command: '/plugins/acme.kit/bin/docs',
        args: ['--root', '/plugins/acme.kit'],
        env: {},
      },
      {
        name: 'acme.kit.web',
        origin: 'plugin',
        transport: 'http',
        url: 'https://mcp.example/sse',
        headers: {},
      },
    ]);
  });

  it('skips disabled plugins, plain-http remote servers and names that are too long', () => {
    expect(
      pluginMcpServers([plugin({ mcpServers: { a: { command: 'x' } } }, { enabled: false })]),
    ).toEqual({ servers: [], errors: [] });
    const refused = pluginMcpServers([
      plugin({ mcpServers: { web: { url: 'http://remote.example/mcp' } } }),
      plugin({ mcpServers: { [`s${'x'.repeat(60)}`]: { command: 'x' } } }, { publisher: 'b' }),
    ]);
    expect(refused.servers).toEqual([]);
    expect(refused.errors).toHaveLength(2);
    expect(refused.errors[0]).toContain('https');
    expect(refused.errors[1]).toContain('too long');
  });
});

describe('plugin agents', () => {
  it('turns a Markdown agent into a sub-agent definition', () => {
    expect(
      pluginAgentDefinition({
        pluginId: 'acme.kit',
        fileName: 'reviewer.md',
        content: '---\ndescription: Reviews diffs\n---\nReview carefully.',
      }),
    ).toEqual({
      name: 'reviewer',
      description: 'Reviews diffs',
      systemPrompt: 'Review carefully.',
    });
    expect(
      pluginAgentDefinition({ pluginId: 'acme.kit', fileName: 'doc.md', content: 'Document.' }),
    ).toEqual({
      name: 'doc',
      description: 'Agent from plugin acme.kit',
      systemPrompt: 'Document.',
    });
  });

  it('drops files that are not a valid definition', () => {
    expect(
      pluginAgentDefinition({ pluginId: 'p', fileName: 'Bad Name.md', content: 'x' }),
    ).toBeUndefined();
    expect(
      pluginAgentDefinition({ pluginId: 'p', fileName: 'ok.md', content: 'x'.repeat(20_001) }),
    ).toBeUndefined();
  });

  it('keeps the project definitions and adds only free plugin names', () => {
    const own = [{ name: 'reviewer', description: 'mine', systemPrompt: 'mine' }];
    const merged = mergeSubAgentDefinitions(own, [
      { name: 'reviewer', description: 'plugin', systemPrompt: 'plugin' },
      { name: 'doc', description: 'first', systemPrompt: 'first' },
      { name: 'doc', description: 'second', systemPrompt: 'second' },
    ]);
    expect(merged.map((definition) => definition.description)).toEqual(['mine', 'first']);
  });
});
