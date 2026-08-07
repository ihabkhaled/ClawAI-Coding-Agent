import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { workspaceFolderKey } from '../../src/core/workspace-scope';
import { WorkspaceContextService } from '../../src/services/workspace-context-service';
import { WorkspaceScopeService } from '../../src/services/workspace-scope-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const vscodeEnvironment = vi.hoisted(() => ({
  activeTextEditor: undefined as
    | {
        document: {
          uri: { fsPath: string; path: string; scheme: string; toString(): string };
          getText(): string;
        };
        selection: { isEmpty: boolean };
      }
    | undefined,
  trusted: true,
  workspaceFolders: [] as {
    name: string;
    uri: { fsPath: string; path: string; scheme: string; toString(): string };
  }[],
}));

const realpathEnvironment = vi.hoisted(() => ({
  errors: new Map<string, unknown>(),
  paths: new Map<string, string>(),
}));

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => {
    if (realpathEnvironment.errors.has(value)) {
      throw realpathEnvironment.errors.get(value);
    }
    return realpathEnvironment.paths.get(value) ?? value;
  }),
}));

vi.mock('vscode', () => ({
  FileType: { File: 1 },
  FileSystemError: class FileSystemError extends Error {
    code = 'FileNotFound';
  },
  Uri: {
    joinPath: (base: { path: string; scheme: string; toString(): string }, ...parts: string[]) => ({
      fsPath: [base.path, ...parts].join('/'),
      path: [base.path, ...parts].join('/'),
      scheme: base.scheme,
      toString: () => `${base.toString()}/${parts.join('/')}`,
    }),
  },
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: { name: string },
      readonly pattern: string,
    ) {}
  },
  l10n: {
    t: (message: string) => message,
  },
  window: {
    get activeTextEditor() {
      return vscodeEnvironment.activeTextEditor;
    },
  },
  workspace: {
    asRelativePath: (uri: { path: string }) => uri.path.replace('/workspace/', ''),
    findFiles: vi.fn(async () => []),
    getWorkspaceFolder: (uri: { path: string }) =>
      vscodeEnvironment.workspaceFolders.find((folder) =>
        uri.path.startsWith(`${folder.uri.path}/`),
      ),
    fs: {
      readFile: vi.fn(async () => new Uint8Array()),
      stat: vi.fn(),
    },
    get isTrusted() {
      return vscodeEnvironment.trusted;
    },
    get workspaceFolders() {
      return vscodeEnvironment.workspaceFolders;
    },
  },
}));

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  effortMode: 'ULTRA',
  speedMode: '1X',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 10_000,
  maxContextFiles: 10,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('WorkspaceContextService smart context', () => {
  beforeEach(() => {
    realpathEnvironment.errors.clear();
    realpathEnvironment.paths.clear();
    vscodeEnvironment.activeTextEditor = undefined;
    vscodeEnvironment.trusted = true;
    vscodeEnvironment.workspaceFolders = [
      {
        name: 'claw-workspace',
        uri: {
          fsPath: '/workspace',
          path: '/workspace',
          scheme: 'file',
          toString: () => 'file:///workspace',
        },
      },
    ];
    vi.clearAllMocks();
  });

  it('collects the trusted workspace when no editor is active', async () => {
    const service = new WorkspaceContextService();

    await expect(service.smart(configuration)).resolves.toMatchObject({
      files: [],
      receipt: {
        included: [],
        totalBytes: 0,
      },
    });
    expect(service.readiness()).toEqual({
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: true,
      workspaceName: 'claw-workspace',
    });
  });

  it('uses empty context instead of throwing when no workspace or editor exists', async () => {
    vscodeEnvironment.workspaceFolders = [];
    const service = new WorkspaceContextService();

    await expect(service.smart(configuration)).resolves.toMatchObject({
      files: [],
      receipt: {
        included: [],
      },
    });
  });

  it('falls back to workspace context when the active editor belongs elsewhere', async () => {
    vscodeEnvironment.activeTextEditor = {
      document: {
        uri: {
          fsPath: '/outside/file.ts',
          path: '/outside/file.ts',
          scheme: 'file',
          toString: () => 'file:///outside/file.ts',
        },
        getText: () => 'outside',
      },
      selection: { isEmpty: true },
    };
    const service = new WorkspaceContextService();

    await expect(service.smart(configuration)).resolves.toMatchObject({
      files: [],
      receipt: { included: [] },
    });
    expect(service.readiness()).toMatchObject({
      hasActiveFile: false,
      hasWorkspace: true,
    });
    expect(vscode.workspace.findFiles).toHaveBeenCalledOnce();
  });

  it('collects files and project rules only from the explicitly selected multi-root folder', async () => {
    const api = {
      name: 'api',
      uri: {
        fsPath: '/workspace/api',
        path: '/workspace/api',
        scheme: 'file',
        toString: () => 'file:///workspace/api',
      },
    };
    const web = {
      name: 'web',
      uri: {
        fsPath: '/workspace/web',
        path: '/workspace/web',
        scheme: 'file',
        toString: () => 'file:///workspace/web',
      },
    };
    vscodeEnvironment.workspaceFolders = [api, web];
    const scope = new WorkspaceScopeService();
    scope.select(workspaceFolderKey(web.uri.toString()));
    const service = new WorkspaceContextService(undefined, scope);

    await service.workspace(configuration);
    await service.projectRules();

    expect(vi.mocked(vscode.workspace.findFiles)).toHaveBeenCalledWith(
      expect.objectContaining({ base: web, pattern: '**/*' }),
      undefined,
      100,
    );
    expect(vi.mocked(vscode.workspace.fs.readFile)).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/web/.clawai/rules.md' }),
    );
  });

  it('never reads sensitive workspace paths into memory', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      {
        fsPath: '/workspace/src/app.ts',
        path: '/workspace/src/app.ts',
        toString: () => 'file:///workspace/src/app.ts',
      } as vscode.Uri,
      {
        fsPath: '/workspace/.ssh/id_ed25519',
        path: '/workspace/.ssh/id_ed25519',
        toString: () => 'file:///workspace/.ssh/id_ed25519',
      } as vscode.Uri,
      {
        fsPath: '/workspace/config/private-key.pem',
        path: '/workspace/config/private-key.pem',
        toString: () => 'file:///workspace/config/private-key.pem',
      } as vscode.Uri,
    ]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      ctime: 0,
      mtime: 0,
      size: 12,
      type: vscode.FileType.File,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
      uri.path.endsWith('/.clawai/ignore')
        ? new Uint8Array()
        : new TextEncoder().encode('safe source'),
    );

    const service = new WorkspaceContextService();
    const context = await service.workspace(configuration);

    expect(context.files).toEqual([{ path: 'src/app.ts', content: 'safe source' }]);
    expect(context.receipt.excluded).toEqual([
      { path: '.ssh/id_ed25519', reason: 'sensitive' },
      { path: 'config/private-key.pem', reason: 'sensitive' },
    ]);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledOnce();
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('.ssh') }),
    );
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('private-key') }),
    );
  });

  it('rejects an active file whose real path escapes the selected workspace', async () => {
    vscodeEnvironment.activeTextEditor = {
      document: {
        uri: {
          fsPath: '/workspace/src/helpful-notes.txt',
          path: '/workspace/src/helpful-notes.txt',
          scheme: 'file',
          toString: () => 'file:///workspace/src/helpful-notes.txt',
        },
        getText: () => 'private key material',
      },
      selection: { isEmpty: true },
    };
    realpathEnvironment.paths.set('/workspace/src/helpful-notes.txt', '/home/user/.ssh/id_ed25519');
    const service = new WorkspaceContextService();

    await expect(service.activeFile(configuration)).rejects.toThrow(
      'The file is outside the selected workspace folder.',
    );
  });

  it('rejects a scanned workspace file whose real path escapes the selected workspace', async () => {
    const linkedFile = {
      fsPath: '/workspace/src/helpful-notes.txt',
      path: '/workspace/src/helpful-notes.txt',
      scheme: 'file',
      toString: () => 'file:///workspace/src/helpful-notes.txt',
    } as vscode.Uri;
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([linkedFile]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      ctime: 0,
      mtime: 0,
      size: 20,
      type: vscode.FileType.File,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('private key material'),
    );
    realpathEnvironment.paths.set(linkedFile.fsPath, '/home/user/.ssh/id_ed25519');
    const service = new WorkspaceContextService();

    await expect(service.workspace(configuration)).rejects.toThrow(
      'The file is outside the selected workspace folder.',
    );
  });

  it('rejects a project rules file whose real path escapes the selected workspace', async () => {
    realpathEnvironment.paths.set(
      '/workspace/.clawai/rules.md',
      '/home/user/.config/clawai/private-rules.md',
    );
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('private instructions'),
    );
    const service = new WorkspaceContextService();

    await expect(service.projectRules()).rejects.toThrow(
      'The file is outside the selected workspace folder.',
    );
  });

  it('does not read root-level directories excluded by recursive glob patterns', async () => {
    const excludedNodeModules = {
      fsPath: '/workspace/node_modules/pkg/index.js',
      path: '/workspace/node_modules/pkg/index.js',
      scheme: 'file',
      toString: () => 'file:///workspace/node_modules/pkg/index.js',
    } as vscode.Uri;
    const excludedDist = {
      fsPath: '/workspace/dist/bundle.js',
      path: '/workspace/dist/bundle.js',
      scheme: 'file',
      toString: () => 'file:///workspace/dist/bundle.js',
    } as vscode.Uri;
    const includedSource = {
      fsPath: '/workspace/src/app.ts',
      path: '/workspace/src/app.ts',
      scheme: 'file',
      toString: () => 'file:///workspace/src/app.ts',
    } as vscode.Uri;
    const binarySource = {
      fsPath: '/workspace/src/data.bin',
      path: '/workspace/src/data.bin',
      scheme: 'file',
      toString: () => 'file:///workspace/src/data.bin',
    } as vscode.Uri;
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce([
      excludedNodeModules,
      excludedDist,
      includedSource,
      binarySource,
    ]);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      ctime: 0,
      mtime: 0,
      size: 11,
      type: vscode.FileType.File,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
      uri.path.endsWith('/.clawai/ignore')
        ? new Uint8Array()
        : uri.path.endsWith('/data.bin')
          ? new Uint8Array([0])
          : new TextEncoder().encode('safe source'),
    );
    const service = new WorkspaceContextService();

    const context = await service.workspace({
      ...configuration,
      exclude: ['**/node_modules/**', '**/dist/**'],
    });

    expect(context.files).toEqual([{ path: 'src/app.ts', content: 'safe source' }]);
    expect(context.receipt.excluded).toEqual([
      { path: 'node_modules/pkg/index.js', reason: 'excluded' },
      { path: 'dist/bundle.js', reason: 'excluded' },
      { path: 'src/data.bin', reason: 'binary' },
    ]);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(2);
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(excludedNodeModules);
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(excludedDist);
  });

  it('bounds aggregate file reads before loading near-limit candidates into memory', async () => {
    const discoveredFiles = Array.from({ length: 20 }, (_, index) => {
      const path = `/workspace/src/file-${index.toString()}.ts`;
      return {
        fsPath: path,
        path,
        scheme: 'file',
        toString: () => `file://${path}`,
      } as vscode.Uri;
    });
    vi.mocked(vscode.workspace.findFiles).mockResolvedValueOnce(discoveredFiles);
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      ctime: 0,
      mtime: 0,
      size: 8,
      type: vscode.FileType.File,
    });
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
      uri.path.endsWith('/.clawai/ignore')
        ? new Uint8Array()
        : new TextEncoder().encode('12345678'),
    );
    const service = new WorkspaceContextService();

    const context = await service.workspace({
      ...configuration,
      maxContextBytes: 10,
      maxContextFiles: 2,
    });
    const sourceReads = vi
      .mocked(vscode.workspace.fs.readFile)
      .mock.calls.filter(([uri]) => uri.path.includes('/src/'));

    expect(context.files).toEqual([{ path: 'src/file-0.ts', content: '12345678' }]);
    expect(context.receipt).toMatchObject({
      included: ['src/file-0.ts'],
      totalBytes: 8,
      truncated: true,
    });
    expect(context.receipt.excluded).toHaveLength(19);
    expect(context.receipt.excluded).toContainEqual({
      path: 'src/file-1.ts',
      reason: 'limit',
    });
    expect(context.receipt.excluded).toContainEqual({
      path: 'src/file-19.ts',
      reason: 'limit',
    });
    expect(sourceReads).toHaveLength(1);
  });
});
