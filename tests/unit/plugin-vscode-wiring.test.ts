import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => {
  class FileSystemError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  const fs = {
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    delete: vi.fn(),
  };
  const configuration = { get: vi.fn(), update: vi.fn() };
  return {
    FileSystemError,
    fs,
    configuration,
    registerCommand: vi.fn((command: string, callback: () => unknown) => ({ command, callback })),
  };
});

vi.mock('vscode', () => ({
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  FileSystemError: vscodeMock.FileSystemError,
  ConfigurationTarget: { Global: 1 },
  Uri: {
    file: (path: string) => ({ fsPath: path }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    }),
  },
  l10n: { t: (message: string) => message },
  window: {
    showQuickPick: vi.fn(async () => undefined),
    registerTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  TreeItemCollapsibleState: { None: 0 },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  commands: { registerCommand: vscodeMock.registerCommand },
  workspace: {
    fs: vscodeMock.fs,
    isTrusted: true,
    getConfiguration: () => vscodeMock.configuration,
  },
}));

const { VscodePluginFileSystem } =
  await import('../../src/infrastructure/vscode-plugin-file-system');
const { registerPluginCommands } = await import('../../src/services/register-plugin-commands');
const { workspacePluginStore } = await import('../../src/services/workspace-plugins');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VscodePluginFileSystem', () => {
  const files = new VscodePluginFileSystem();

  it('lists files and folders only, and a missing folder as empty', async () => {
    vscodeMock.fs.readDirectory.mockResolvedValueOnce([
      ['a.md', 1],
      ['skills', 2],
      ['link', 64],
    ]);

    await expect(files.list('/p')).resolves.toEqual([
      { name: 'a.md', kind: 'file' },
      { name: 'skills', kind: 'directory' },
    ]);
    vscodeMock.fs.readDirectory.mockRejectedValueOnce(new Error('missing'));
    await expect(files.list('/gone')).resolves.toEqual([]);
  });

  it('reads a missing file as undefined and writes through', async () => {
    vscodeMock.fs.readFile.mockResolvedValueOnce(new Uint8Array([1]));
    await expect(files.readFile('/a')).resolves.toEqual(new Uint8Array([1]));
    vscodeMock.fs.readFile.mockRejectedValueOnce(new Error('missing'));
    await expect(files.readFile('/b')).resolves.toBeUndefined();

    await files.writeFile('/c', new Uint8Array());
    expect(vscodeMock.fs.writeFile).toHaveBeenCalledWith({ fsPath: '/c' }, new Uint8Array());
  });

  it('ignores deleting what is not there, and rethrows anything else', async () => {
    vscodeMock.fs.delete.mockRejectedValueOnce(new vscodeMock.FileSystemError('FileNotFound'));
    await expect(files.delete('/gone')).resolves.toBeUndefined();
    vscodeMock.fs.delete.mockRejectedValueOnce(new vscodeMock.FileSystemError('NoPermissions'));
    await expect(files.delete('/locked')).rejects.toThrow('NoPermissions');
  });

  it('joins paths', () => {
    expect(files.join('/a', 'b', 'c').replaceAll('\\', '/')).toBe('/a/b/c');
  });
});

describe('workspacePluginStore', () => {
  it('puts user plugins in global storage and workspace plugins in .clawai', () => {
    let folder: { fsPath: string } | undefined = { fsPath: '/repo' };
    const store = workspacePluginStore({ fsPath: '/global' } as never, () => folder as never);

    expect(store.rootFor('user')).toBe('/global/plugins');
    expect(store.rootFor('workspace')).toBe('/repo/.clawai/plugins');
    folder = undefined;
    expect(store.rootFor('workspace')).toBeUndefined();
  });
});

describe('registerPluginCommands', () => {
  function scope(selected: string | undefined) {
    return {
      refresh: () => ({ selectedFolderKey: selected }),
      selectedFolder: () => ({ uri: { fsPath: '/repo' } }),
    };
  }

  it('registers the Plugins view actions, the manager and the marketplace browser', async () => {
    const subscriptions: unknown[] = [];
    vscodeMock.configuration.get.mockReturnValue(['https://m.example', 3]);

    registerPluginCommands(
      { subscriptions, globalStorageUri: { fsPath: '/global' } } as never,
      scope(undefined) as never,
    );

    expect(vscodeMock.registerCommand.mock.calls.map(([command]) => command)).toEqual([
      'clawAI.enablePlugin',
      'clawAI.disablePlugin',
      'clawAI.uninstallPlugin',
      'clawAI.refreshPlugins',
      'clawAI.managePlugins',
      'clawAI.browsePluginMarketplaces',
    ]);
    expect(subscriptions).toHaveLength(8);
    const browse = vscodeMock.registerCommand.mock.calls[5]?.[1];
    await browse?.();
    const manage = vscodeMock.registerCommand.mock.calls[4]?.[1];
    await manage?.();
  });

  it('marks a marketplace the organization allowlist leaves out as blocked', async () => {
    const vscode = await import('vscode');
    vscodeMock.configuration.get.mockReturnValue(['https://m.example']);

    registerPluginCommands(
      { subscriptions: [], globalStorageUri: { fsPath: '/global' } } as never,
      scope(undefined) as never,
      () => ['https://only.example'],
    );
    let described: string | undefined;
    vi.mocked(vscode.window.showQuickPick).mockImplementationOnce(async (items) => {
      described = (await items)[0]?.description;
      return undefined;
    });
    await vscodeMock.registerCommand.mock.calls[5]?.[1]();

    expect(described).toBe('Blocked by policy');
  });
});
