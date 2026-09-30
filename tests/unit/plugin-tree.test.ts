import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

const vscodeMock = vi.hoisted(() => ({
  registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => ({
    command,
    callback,
  })),
  registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showErrorMessage: vi.fn(async () => undefined),
  showWarningMessage: vi.fn(async (): Promise<string | undefined> => undefined),
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/gu, (_, index: string) => String(args[Number(index)])),
  },
  TreeItemCollapsibleState: { None: 0 },
  TreeItem: class {
    description?: string;
    tooltip?: string;
    iconPath?: unknown;
    contextValue?: string;
    constructor(
      readonly label: string,
      readonly collapsibleState: number,
    ) {}
  },
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  EventEmitter: class {
    readonly listeners: ((value: unknown) => void)[] = [];
    readonly event = (listener: (value: unknown) => void) => {
      this.listeners.push(listener);
    };
    fire(value: unknown): void {
      for (const listener of this.listeners) listener(value);
    }
    dispose = vi.fn();
  },
  window: {
    registerTreeDataProvider: vscodeMock.registerTreeDataProvider,
    showErrorMessage: vscodeMock.showErrorMessage,
    showWarningMessage: vscodeMock.showWarningMessage,
  },
  commands: { registerCommand: vscodeMock.registerCommand },
  Uri: {
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: parts.join('/') }),
  },
}));

const { PluginTreeProvider } = await import('../../src/views/plugin-tree-provider');
const { registerPluginTree } = await import('../../src/services/register-plugin-tree');
const { pluginAgents, pluginMcpConfig } = await import('../../src/services/workspace-plugins');

function storeWith(manifest: string, agents: Record<string, string> = {}) {
  const files = new MemoryPluginFileSystem();
  files.put('/profile/plugins/acme.review-kit/clawai-plugin.json', manifest);
  files.put('/profile/plugins/broken/clawai-plugin.json', '{');
  for (const [name, content] of Object.entries(agents)) {
    files.put(`/profile/plugins/acme.review-kit/agents/${name}`, content);
  }
  return new PluginStore(files, { user: () => '/profile/plugins', workspace: () => undefined });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PluginTreeProvider', () => {
  it('lists plugins with their switches, then folders that are not plugins', async () => {
    const store = storeWith(manifestJson());
    const tree = new PluginTreeProvider(() => store.list());
    const nodes = await tree.getChildren();

    expect(nodes.map((node) => node.kind)).toEqual(['plugin', 'invalid']);
    const plugin = tree.getTreeItem(nodes[0] as never);
    expect(plugin.label).toBe('acme.review-kit');
    expect(plugin.description).toBe('1.0.0 · User · Enabled');
    expect(plugin.contextValue).toBe('clawAI.plugin.enabled');
    expect(plugin.tooltip).toContain('MCP servers 1');
    const invalid = tree.getTreeItem(nodes[1] as never);
    expect(invalid.contextValue).toBe('clawAI.plugin.invalid');
    expect(invalid.tooltip).toContain('Not a valid plugin');
    await expect(tree.getChildren(nodes[0])).resolves.toEqual([]);
  });

  it('shows a disabled plugin as disabled, and nothing when the store fails', async () => {
    const store = storeWith(manifestJson());
    const [first] = (await store.list()).plugins;
    if (first === undefined) throw new Error('no plugin');
    await store.setSwitches(first, { enabled: false, hooksEnabled: false });
    const tree = new PluginTreeProvider(() => store.list());
    const [node] = await tree.getChildren();
    expect(tree.getTreeItem(node as never).contextValue).toBe('clawAI.plugin.disabled');

    const failing = new PluginTreeProvider(() => Promise.reject(new Error('disk')));
    await expect(failing.getChildren()).resolves.toEqual([]);
  });

  it('tells listeners when it refreshes', () => {
    const tree = new PluginTreeProvider(async () => ({ plugins: [], invalid: [] }));
    const listener = vi.fn();
    tree.onDidChangeTreeData(listener);
    tree.refresh();
    expect(listener).toHaveBeenCalledWith(undefined);
    tree.dispose();
  });
});

describe('registerPluginTree', () => {
  function command(name: string): (...args: unknown[]) => Promise<void> {
    const call = vscodeMock.registerCommand.mock.calls.find(([id]) => id === name);
    if (call === undefined) throw new Error(`${name} was not registered`);
    return call[1] as (...args: unknown[]) => Promise<void>;
  }

  it('enables, disables and uninstalls through the store, and ignores other rows', async () => {
    const store = storeWith(manifestJson());
    const subscriptions: unknown[] = [];
    const tree = registerPluginTree({ subscriptions } as never, { store } as never);
    const refresh = vi.spyOn(tree, 'refresh');
    expect(vscodeMock.registerTreeDataProvider).toHaveBeenCalledWith('clawAI.plugins', tree);
    expect(subscriptions).toHaveLength(6);

    const [node, invalid] = await tree.getChildren();
    await command('clawAI.disablePlugin')(node);
    expect((await store.list()).plugins[0]?.enabled).toBe(false);
    await command('clawAI.enablePlugin')(node);
    expect((await store.list()).plugins[0]).toMatchObject({ enabled: true, hooksEnabled: false });
    await command('clawAI.enablePlugin')(invalid);
    await command('clawAI.enablePlugin')();
    await command('clawAI.refreshPlugins')();
    expect(refresh).toHaveBeenCalledTimes(3);

    vscodeMock.showWarningMessage.mockResolvedValueOnce('Uninstall');
    await command('clawAI.uninstallPlugin')(node);
    expect((await store.list()).plugins).toEqual([]);
  });

  it('shows a failed action as an error and still refreshes', async () => {
    const store = {
      list: async () => ({ plugins: [], invalid: [] }),
      setSwitches: vi.fn(() => Promise.reject(new Error('read-only'))),
    };
    const tree = registerPluginTree({ subscriptions: [] } as never, { store } as never);
    const refresh = vi.spyOn(tree, 'refresh');
    await command('clawAI.disablePlugin')({ kind: 'plugin', plugin: { root: '/p' } });
    expect(vscodeMock.showErrorMessage).toHaveBeenCalledWith('read-only');
    expect(refresh).toHaveBeenCalled();
  });
});

describe('plugin MCP servers and agents from the store', () => {
  it('reads servers and agents of enabled plugins', async () => {
    const manifest = JSON.stringify({
      name: 'review-kit',
      publisher: 'acme',
      version: '1.0.0',
      contributes: { agents: ['agents'], mcpServers: { docs: { command: 'docs' } } },
    });
    const store = storeWith(manifest, {
      'reviewer.md': '---\ndescription: Reviews\n---\nReview it.',
      'Bad Name.md': 'ignored',
    });

    const mcp = await pluginMcpConfig(store);
    expect(mcp.servers.map((server) => server.name)).toEqual(['acme.review-kit.docs']);
    await expect(pluginAgents(store)).resolves.toEqual([
      { name: 'reviewer', description: 'Reviews', systemPrompt: 'Review it.' },
    ]);

    const [plugin] = (await store.list()).plugins;
    if (plugin === undefined) throw new Error('no plugin');
    await store.setSwitches(plugin, { enabled: false, hooksEnabled: false });
    await expect(pluginAgents(store)).resolves.toEqual([]);
    expect((await pluginMcpConfig(store)).servers).toEqual([]);
  });

  it('contributes nothing, and says why, when the store cannot be read', async () => {
    const broken = { list: () => Promise.reject(new Error('disk gone')) } as never;
    await expect(pluginMcpConfig(broken)).resolves.toEqual({
      servers: [],
      errors: ['plugin MCP servers could not be read: disk gone'],
    });
    await expect(pluginAgents(broken)).resolves.toEqual([]);
  });
});
