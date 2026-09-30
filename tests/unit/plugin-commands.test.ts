import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PluginFailure } from '../../src/core/plugin-failure';
import { PluginMarketplaceService } from '../../src/services/plugin-marketplace-service';
import { PluginStore } from '../../src/services/plugin-store';
import { MemoryPluginFileSystem, manifestJson } from '../helpers/memory-plugin-file-system';

import type { PluginCommandDependencies } from '../../src/services/plugin-commands.types';

const windowMock = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  showOpenDialog: vi.fn(),
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: unknown[]) =>
      values.reduce<string>(
        (text, value, index) => text.replace(`{${String(index)}}`, String(value)),
        message,
      ),
  },
  window: windowMock,
}));

const { managePlugins } = await import('../../src/services/plugin-commands');
const { browsePluginMarketplaces } = await import('../../src/services/plugin-marketplace-commands');
const { pluginFailureMessage } = await import('../../src/services/plugin-failure-message');

type Picker = (items: readonly { label: string }[]) => unknown;

function pickInOrder(...choosers: Picker[]): void {
  for (const choose of choosers) {
    windowMock.showQuickPick.mockImplementationOnce(async (items: readonly { label: string }[]) =>
      choose(items),
    );
  }
}

const byLabel =
  (fragment: string): Picker =>
  (items) =>
    items.find((item) => item.label.includes(fragment));

function setup(options: { trusted?: boolean; workspace?: boolean } = {}) {
  const files = new MemoryPluginFileSystem();
  files.put('/u/acme.review-kit/clawai-plugin.json', manifestJson());
  files.put('/u/broken/clawai-plugin.json', '{');
  const store = new PluginStore(files, {
    user: () => '/u',
    workspace: () => (options.workspace === false ? undefined : '/w'),
  });
  const service = new PluginMarketplaceService({
    store,
    files,
    download: vi.fn(),
    unzip: vi.fn(),
    allowlist: async () => undefined,
  });
  const marketplace = {
    open: vi.spyOn(service, 'open').mockImplementation(async (source: string) => ({
      source,
      location: { kind: 'url', url: source },
      catalog: {
        name: 'Acme',
        plugins: [
          {
            name: 'kit',
            publisher: 'acme',
            version: '1.0.0',
            description: 'd',
            source: 'kit.zip',
            sha256: 'a'.repeat(64),
          },
        ],
      },
    })),
    install: vi.spyOn(service, 'install').mockResolvedValue('/u/acme.kit'),
    installFolder: vi.spyOn(service, 'installFolder').mockResolvedValue('/u/acme.local'),
  };
  let saved: readonly string[] = ['https://m.example/c.json'];
  const dependencies: PluginCommandDependencies = {
    store,
    marketplace: service,
    trusted: () => options.trusted ?? true,
    marketplaces: () => saved,
    saveMarketplaces: vi.fn(async (sources: readonly string[]) => {
      saved = sources;
    }),
    allowlist: async () => ['https://allowed.example'],
  };
  return { files, store, marketplace, dependencies, saved: () => saved };
}

beforeEach(() => {
  vi.clearAllMocks();
  windowMock.showQuickPick.mockReset();
});

describe('managePlugins', () => {
  it('lists plugins and invalid folders, and does nothing when dismissed', async () => {
    const { dependencies } = setup();
    windowMock.showQuickPick.mockResolvedValueOnce(undefined);

    await managePlugins(dependencies);

    const items = windowMock.showQuickPick.mock.calls[0]?.[0] as { label: string }[];
    expect(items.map((item) => item.label)).toEqual(
      expect.arrayContaining([
        '$(extensions) acme.review-kit',
        expect.stringContaining('$(warning)'),
      ]),
    );
  });

  it('disables and re-enables a plugin', async () => {
    const { dependencies, store } = setup();
    pickInOrder(byLabel('acme.review-kit'), byLabel('Disable'));
    await managePlugins(dependencies);
    expect((await store.list()).plugins[0]?.enabled).toBe(false);

    pickInOrder(byLabel('acme.review-kit'), byLabel('Enable'));
    await managePlugins(dependencies);
    expect((await store.list()).plugins[0]?.enabled).toBe(true);
  });

  it('refuses to turn hooks on in an untrusted workspace', async () => {
    const { dependencies, store } = setup({ trusted: false });
    pickInOrder(byLabel('acme.review-kit'), byLabel('Turn hooks on'));

    await managePlugins(dependencies);

    expect(windowMock.showWarningMessage).toHaveBeenCalledWith(
      'Plugin hooks can only run in a trusted workspace.',
    );
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(false);
  });

  it('turns hooks on only after an explicit yes naming the commands, and off again', async () => {
    const { dependencies, store } = setup();
    pickInOrder(byLabel('acme.review-kit'), byLabel('Turn hooks on'));
    windowMock.showWarningMessage.mockResolvedValueOnce(undefined);
    await managePlugins(dependencies);
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(false);

    pickInOrder(byLabel('acme.review-kit'), byLabel('Turn hooks on'));
    windowMock.showWarningMessage.mockResolvedValueOnce('Turn on');
    await managePlugins(dependencies);
    expect(windowMock.showWarningMessage).toHaveBeenLastCalledWith(
      expect.stringContaining('${pluginRoot}/guard.sh'),
      { modal: true },
      'Turn on',
    );
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(true);

    pickInOrder(byLabel('acme.review-kit'), byLabel('Turn hooks off'));
    await managePlugins(dependencies);
    expect((await store.list()).plugins[0]?.hooksEnabled).toBe(false);
  });

  it('uninstalls only after confirmation', async () => {
    const { dependencies, store } = setup();
    pickInOrder(byLabel('acme.review-kit'), byLabel('Uninstall'));
    windowMock.showWarningMessage.mockResolvedValueOnce(undefined);
    await managePlugins(dependencies);
    expect((await store.list()).plugins).toHaveLength(1);

    pickInOrder(byLabel('acme.review-kit'), byLabel('Uninstall'));
    windowMock.showWarningMessage.mockResolvedValueOnce('Uninstall');
    await managePlugins(dependencies);
    expect((await store.list()).plugins).toHaveLength(0);
  });

  it('reports an action that fails', async () => {
    const { dependencies, store } = setup();
    vi.spyOn(store, 'setSwitches').mockRejectedValueOnce(new PluginFailure('too-large'));
    pickInOrder(byLabel('acme.review-kit'), byLabel('Disable'));

    await managePlugins(dependencies);

    expect(windowMock.showErrorMessage).toHaveBeenCalledWith('The plugin is too large.');
  });

  it('installs from a picked folder into the chosen scope', async () => {
    const { dependencies, marketplace } = setup();
    windowMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/picked' }]);
    pickInOrder(byLabel('Install a plugin from a folder'), byLabel('Workspace'));

    await managePlugins(dependencies);

    expect(marketplace.installFolder).toHaveBeenCalledWith('/picked', 'workspace');
    expect(windowMock.showInformationMessage).toHaveBeenCalledWith('Installed /u/acme.local.');
  });

  it('stops when no folder or no scope is chosen, and reports install failures', async () => {
    const { dependencies, marketplace } = setup();
    windowMock.showOpenDialog.mockResolvedValueOnce(undefined);
    pickInOrder(byLabel('Install a plugin from a folder'));
    await managePlugins(dependencies);

    windowMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/picked' }]);
    pickInOrder(byLabel('Install a plugin from a folder'), () => undefined);
    await managePlugins(dependencies);
    expect(marketplace.installFolder).not.toHaveBeenCalled();

    marketplace.installFolder.mockRejectedValueOnce(new PluginFailure('invalid-manifest', 'x'));
    windowMock.showOpenDialog.mockResolvedValueOnce([{ fsPath: '/picked' }]);
    pickInOrder(byLabel('Install a plugin from a folder'), byLabel('User'));
    await managePlugins(dependencies);
    expect(windowMock.showErrorMessage).toHaveBeenCalledWith('The plugin manifest is not valid: x');
  });

  it('opens the marketplace browser from the manager', async () => {
    const { dependencies } = setup();
    pickInOrder(byLabel('Browse plugin marketplaces'), () => undefined);

    await managePlugins(dependencies);

    expect(windowMock.showQuickPick).toHaveBeenCalledTimes(2);
  });
});

describe('browsePluginMarketplaces', () => {
  it('marks marketplaces policy blocks', async () => {
    const { dependencies } = setup();
    windowMock.showQuickPick.mockResolvedValueOnce(undefined);

    await browsePluginMarketplaces(dependencies);

    const items = windowMock.showQuickPick.mock.calls[0]?.[0] as { description?: string }[];
    expect(items[0]?.description).toBe('Blocked by policy');
  });

  it('adds and removes marketplaces, ignoring blanks and duplicates', async () => {
    const context = setup();
    windowMock.showInputBox.mockResolvedValueOnce(' https://n.example/c.json ');
    pickInOrder(byLabel('Add a marketplace'));
    await browsePluginMarketplaces(context.dependencies);
    expect(context.saved()).toEqual(['https://m.example/c.json', 'https://n.example/c.json']);

    windowMock.showInputBox.mockResolvedValueOnce('https://n.example/c.json');
    pickInOrder(byLabel('Add a marketplace'));
    await browsePluginMarketplaces(context.dependencies);
    expect(context.saved()).toHaveLength(2);

    pickInOrder(byLabel('Remove a marketplace'), () => 'https://m.example/c.json');
    await browsePluginMarketplaces(context.dependencies);
    expect(context.saved()).toEqual(['https://n.example/c.json']);

    pickInOrder(byLabel('Remove a marketplace'), () => undefined);
    await browsePluginMarketplaces(context.dependencies);
    expect(context.saved()).toHaveLength(1);
  });

  it('installs a chosen plugin into the only scope when no folder is open', async () => {
    const { dependencies, marketplace } = setup({ workspace: false });
    pickInOrder(byLabel('m.example'), byLabel('acme.kit'));

    await browsePluginMarketplaces(dependencies);

    expect(marketplace.install).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'https://m.example/c.json' }),
      expect.objectContaining({ name: 'kit' }),
      'user',
    );
    expect(windowMock.showInformationMessage).toHaveBeenCalledWith('Installed acme.kit.');
  });

  it('stops when no plugin or scope is chosen, and reports failures', async () => {
    const { dependencies, marketplace } = setup();
    pickInOrder(byLabel('m.example'), () => undefined);
    await browsePluginMarketplaces(dependencies);
    pickInOrder(byLabel('m.example'), byLabel('acme.kit'), () => undefined);
    await browsePluginMarketplaces(dependencies);
    expect(marketplace.install).not.toHaveBeenCalled();

    marketplace.open.mockRejectedValueOnce(new PluginFailure('not-allowed', 'x'));
    pickInOrder(byLabel('m.example'));
    await browsePluginMarketplaces(dependencies);
    expect(windowMock.showErrorMessage).toHaveBeenCalledWith(
      'Policy does not allow this marketplace: x',
    );
  });
});

describe('pluginFailureMessage', () => {
  it.each([
    ['digest-mismatch', 'sha256'],
    ['invalid-catalog', 'catalog'],
    ['invalid-source', 'source'],
    ['name-mismatch', 'entry'],
    ['unreachable', 'reach'],
    ['unsafe-path', 'unsafe'],
  ] as const)('explains %s', (code, fragment) => {
    expect(pluginFailureMessage(new PluginFailure(code, 'd'))).toContain(fragment);
  });

  it('keeps unexpected errors as they are', () => {
    expect(pluginFailureMessage(new Error('boom'))).toBe('boom');
    expect(pluginFailureMessage('plain')).toBe('plain');
  });
});
