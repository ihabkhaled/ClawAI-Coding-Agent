import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { WorkspaceContextService } from '../../src/services/workspace-context-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const vscodeEnvironment = vi.hoisted(() => ({
  activeTextEditor: undefined as
    | {
        document: {
          uri: { fsPath: string; path: string; scheme: string; toString(): string };
          getText(range?: unknown): string;
        };
        selection: unknown;
      }
    | undefined,
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
      return true;
    },
    get workspaceFolders() {
      return vscodeEnvironment.workspaceFolders;
    },
  },
}));

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  viewDensity: 'full' as const,
  outputStyle: 'default',
  hooks: [],
  effortMode: 'ULTRA',
  speedMode: '1X',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 10_000,
  maxContextFiles: 10,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  autosave: 'off' as const,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('WorkspaceContextService line-range candidates', () => {
  beforeEach(() => {
    realpathEnvironment.errors.clear();
    realpathEnvironment.paths.clear();
    vscodeEnvironment.activeTextEditor = undefined;
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

  it('preserves the selection line range in the candidate and receipt', async () => {
    vscodeEnvironment.activeTextEditor = {
      document: {
        uri: {
          fsPath: '/workspace/src/app.ts',
          path: '/workspace/src/app.ts',
          scheme: 'file',
          toString: () => 'file:///workspace/src/app.ts',
        },
        getText: () => 'const x = 1;',
      },
      selection: { isEmpty: false, start: { line: 9 }, end: { line: 11 } },
    };
    const service = new WorkspaceContextService();

    const context = await service.selection(configuration);

    expect(context.files).toEqual([
      { path: 'src/app.ts', content: 'const x = 1;', startLine: 10, endLine: 12 },
    ]);
    expect(context.receipt.included).toEqual([{ path: 'src/app.ts', startLine: 10, endLine: 12 }]);
  });

  describe('referencedRanges', () => {
    it('returns empty context when the prompt has no references', async () => {
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('no references here', configuration);

      expect(context.files).toEqual([]);
    });

    it('returns empty context when no workspace is open', async () => {
      vscodeEnvironment.workspaceFolders = [];
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/app.ts:1-5', configuration);

      expect(context.files).toEqual([]);
    });

    it('pulls a whole file in for an @ mention', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('one\ntwo'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('look at @src/app.ts please', configuration);

      expect(context.files).toEqual([{ path: 'src/app.ts', content: 'one\ntwo' }]);
    });

    it('reads the range, not the whole file, when the mention carries one', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('one\ntwo\nthree'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('see @src/app.ts:2-2', configuration);

      expect(context.files).toEqual([
        { path: 'src/app.ts', content: 'two', startLine: 2, endLine: 2 },
      ]);
    });

    it('refuses to hand over a secret because someone mentioned it, and says so', async () => {
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('read @.env for the key', configuration);

      expect(context.files).toEqual([]);
      expect(context.receipt.excluded).toEqual([{ path: '.env', reason: 'sensitive' }]);
    });

    it('ignores an email address that is not a file', async () => {
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('mail ihab@example.com', configuration);

      expect(context.files).toEqual([]);
    });

    it('resolves a referenced range from the workspace', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('one\ntwo\nthree\nfour\nfive'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges(
        'See src/app.ts:2-3 for details',
        configuration,
      );

      expect(context.files).toEqual([
        { path: 'src/app.ts', content: 'two\nthree', startLine: 2, endLine: 3 },
      ]);
      expect(context.receipt.included).toEqual([{ path: 'src/app.ts', startLine: 2, endLine: 3 }]);
    });

    it('clamps a range past the end of the file rather than failing', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('one\ntwo'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/app.ts:1-100', configuration);

      expect(context.files).toEqual([
        { path: 'src/app.ts', content: 'one\ntwo', startLine: 1, endLine: 2 },
      ]);
    });

    it('silently skips a reference whose start line is past the end of the file', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('one\ntwo'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/app.ts:50-60', configuration);

      expect(context.files).toEqual([]);
    });

    it('silently skips a reference to a file that does not exist', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(
        new vscode.FileSystemError('not found'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/missing.ts:1-5', configuration);

      expect(context.files).toEqual([]);
    });

    it('silently skips a reference whose real path escapes the workspace', async () => {
      realpathEnvironment.paths.set('/workspace/src/link.ts', '/home/user/.ssh/id_ed25519');
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/link.ts:1-5', configuration);

      expect(context.files).toEqual([]);
      expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    });

    it('never surfaces a sensitive path even when explicitly referenced', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(
        new TextEncoder().encode('SECRET=1'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('.env:1', configuration);

      expect(context.files).toEqual([]);
      expect(context.receipt.excluded).toEqual([{ path: '.env', reason: 'sensitive' }]);
    });

    it('resolves multiple references in one prompt', async () => {
      vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
        uri.path.endsWith('a.ts')
          ? new TextEncoder().encode('alpha')
          : new TextEncoder().encode('beta'),
      );
      const service = new WorkspaceContextService();

      const context = await service.referencedRanges('src/a.ts:1 and src/b.ts:1', configuration);

      expect(context.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    });
  });
});

describe('WorkspaceContextService nested memory files', () => {
  beforeEach(() => {
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
    vscodeEnvironment.activeTextEditor = undefined;
    vi.clearAllMocks();
  });

  it('reads only the root memory files when no file is open', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('rule'));
    const service = new WorkspaceContextService();

    await service.projectRules();

    const read = vi
      .mocked(vscode.workspace.fs.readFile)
      .mock.calls.map(([uri]) => (uri as { path: string }).path);
    expect(read).toEqual([
      '/workspace/.clawai/rules.md',
      '/workspace/.clawai/architecture.md',
      '/workspace/.clawai/memory.md',
    ]);
  });

  it('reads nested memory files with the nearest directory last', async () => {
    vscodeEnvironment.activeTextEditor = {
      document: {
        uri: {
          fsPath: '/workspace/apps/web/app.ts',
          path: '/workspace/apps/web/app.ts',
          scheme: 'file',
          toString: () => 'file:///workspace/apps/web/app.ts',
        },
        getText: () => '',
      },
      selection: { isEmpty: true },
    };
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('rule'));
    const service = new WorkspaceContextService();

    await service.projectRules();

    const read = vi
      .mocked(vscode.workspace.fs.readFile)
      .mock.calls.map(([uri]) => (uri as { path: string }).path);
    expect(read[0]).toBe('/workspace/.clawai/rules.md');
    expect(read.at(-1)).toBe('/workspace/apps/web/.clawai/memory.md');
    expect(read).toContain('/workspace/apps/.clawai/rules.md');
  });
});
