import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const vscodeEnvironment = vi.hoisted(() => ({
  appliedEdit: undefined as
    | {
        creates: { path: string; content: string }[];
        deletes: { path: string }[];
        replacements: { path: string; content: string }[];
      }
    | undefined,
  appliedResult: true,
  changeListener: undefined as
    ((event: { document: { uri: { toString(): string } } }) => void) | undefined,
  documents: [] as { uri: { path: string; toString(): string }; getText(): string }[],
  files: new Map<string, string>(),
  onRead: undefined as ((path: string) => Promise<void> | void) | undefined,
  readError: undefined as Error | undefined,
  taskEndListener: undefined as
    ((event: { execution: unknown; exitCode: number | undefined }) => void) | undefined,
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

vi.mock('vscode', () => {
  class FileSystemError extends Error {
    code = 'FileNotFound';
  }
  class WorkspaceEdit {
    readonly creates: { path: string; content: string }[] = [];
    readonly deletes: { path: string }[] = [];
    readonly replacements: { path: string; content: string }[] = [];
    createFile(uri: { path: string }, options?: { contents?: Uint8Array }): void {
      this.creates.push({
        path: uri.path,
        content: options?.contents === undefined ? '' : new TextDecoder().decode(options.contents),
      });
    }
    deleteFile(uri: { path: string }): void {
      this.deletes.push({ path: uri.path });
    }
    replace(uri: { path: string }, _range: unknown, content: string): void {
      this.replacements.push({ path: uri.path, content });
    }
  }
  class Task {
    readonly arguments: unknown[];
    presentationOptions: Record<string, unknown> = {};
    constructor(...arguments_: unknown[]) {
      this.arguments = arguments_;
    }
  }
  class ShellExecution {
    readonly arguments: unknown[];
    constructor(...arguments_: unknown[]) {
      this.arguments = arguments_;
    }
  }
  const uri = (path: string) => ({
    fsPath: path,
    path,
    scheme: 'file',
    toString: () => `file://${path}`,
  });
  return {
    FileSystemError,
    Position: class Position {
      constructor(
        readonly line: number,
        readonly character: number,
      ) {}
    },
    Range: class Range {
      constructor(
        readonly start: unknown,
        readonly end: unknown,
      ) {}
    },
    ShellExecution,
    Task,
    TaskPanelKind: { Dedicated: 1 },
    TaskRevealKind: { Always: 1 },
    TaskScope: { Workspace: 1 },
    Uri: {
      file: (path: string) => uri(path),
      parse: (value: string) => uri(value.replace(/^file:\/\//u, '')),
      joinPath: (base: { path: string }, ...parts: string[]) =>
        uri([base.path, ...parts].join('/')),
    },
    l10n: { t: (message: string) => message },
    tasks: {
      executeTask: vi.fn(async () => ({ terminate: vi.fn() })),
      onDidEndTaskProcess: vi.fn(
        (listener: (event: { execution: unknown; exitCode: number | undefined }) => void) => {
          vscodeEnvironment.taskEndListener = listener;
          return { dispose: vi.fn() };
        },
      ),
    },
    WorkspaceEdit,
    workspace: {
      applyEdit: vi.fn(async (edit: InstanceType<typeof WorkspaceEdit>) => {
        vscodeEnvironment.appliedEdit = edit;
        return vscodeEnvironment.appliedResult;
      }),
      fs: {
        readFile: vi.fn(async (target: { path: string }) => {
          if (vscodeEnvironment.readError !== undefined) {
            throw vscodeEnvironment.readError;
          }
          await vscodeEnvironment.onRead?.(target.path);
          const content = vscodeEnvironment.files.get(target.path);
          if (content === undefined) {
            throw new FileSystemError();
          }
          return new TextEncoder().encode(content);
        }),
      },
      isTrusted: true,
      onDidChangeTextDocument: vi.fn(
        (listener: (event: { document: { uri: { toString(): string } } }) => void) => {
          vscodeEnvironment.changeListener = listener;
          return { dispose: vi.fn() };
        },
      ),
      openTextDocument: vi.fn(async (target: { path: string; toString(): string }) => {
        const open = vscodeEnvironment.documents.find(
          (document) => document.uri.toString() === target.toString(),
        );
        const content = open?.getText() ?? vscodeEnvironment.files.get(target.path);
        if (content === undefined) {
          throw new FileSystemError();
        }
        return {
          getText: () => content,
          lineAt: () => ({ rangeIncludingLineBreak: { end: {} } }),
          lineCount: 1,
          uri: target,
        };
      }),
      get textDocuments() {
        return vscodeEnvironment.documents;
      },
      workspaceFolders: [{ name: 'api', uri: { path: '/workspace/api' } }],
    },
  };
});

import { VscodeWorkspaceEditAdapter } from '../../src/infrastructure/vscode-workspace-edit-adapter';

describe('VscodeWorkspaceEditAdapter workspace scope', () => {
  beforeEach(() => {
    vscodeEnvironment.appliedEdit = undefined;
    vscodeEnvironment.appliedResult = true;
    vscodeEnvironment.changeListener = undefined;
    vscodeEnvironment.documents = [];
    vscodeEnvironment.files.clear();
    vscodeEnvironment.onRead = undefined;
    vscodeEnvironment.readError = undefined;
    vscodeEnvironment.taskEndListener = undefined;
    realpathEnvironment.errors.clear();
    realpathEnvironment.paths.clear();
    Object.defineProperty(vscode.workspace, 'isTrusted', {
      configurable: true,
      value: true,
      writable: true,
    });
    vi.mocked(vscode.workspace.applyEdit).mockClear();
    vi.mocked(vscode.tasks.executeTask).mockClear();
  });

  it('creates files under the explicitly selected folder instead of workspace index zero', async () => {
    let selectedFolder = '/workspace/web';
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file(selectedFolder) }),
    });
    const plan = {
      summary: 'Create loop',
      files: [
        {
          path: 'app/for-loop.js',
          operation: 'create' as const,
          content: 'for (let i = 1; i <= 10; i += 1) {}\n',
        },
      ],
    };
    const review = await adapter.preview(plan);
    selectedFolder = '/workspace/api';

    await expect(adapter.applyAtomically(plan, review)).resolves.toBe(true);
    expect(vscodeEnvironment.appliedEdit).toEqual(
      expect.objectContaining({
        creates: [
          {
            path: '/workspace/web/app/for-loop.js',
            content: 'for (let i = 1; i <= 10; i += 1) {}\n',
          },
        ],
        replacements: [],
      }),
    );
  });

  it('rejects an approved edit when the current buffer changed during review', async () => {
    const target = vscode.Uri.file('/workspace/web/src/app.ts');
    vscodeEnvironment.files.set(target.path, 'const value = 1;\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Update value',
      files: [{ path: 'src/app.ts', operation: 'update' as const, content: 'const value = 2;\n' }],
    };
    const review = await adapter.preview(plan);
    vscodeEnvironment.documents = [{ uri: target, getText: () => 'const userEdit = true;\n' }];

    await expect(adapter.applyAtomically(plan, review)).rejects.toThrow(/changed during review/iu);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('includes unsaved editor content in the reviewed before-state', async () => {
    const target = vscode.Uri.file('/workspace/web/src/app.ts');
    vscodeEnvironment.files.set(target.path, 'const disk = true;\n');
    vscodeEnvironment.documents = [{ uri: target, getText: () => 'const unsaved = true;\n' }];
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.preview({
        summary: 'Update value',
        files: [{ path: 'src/app.ts', operation: 'update', content: 'const next = true;\n' }],
      }),
    ).resolves.toMatchObject({
      previews: [{ before: 'const unsaved = true;\n' }],
      workspaceFolderUri: 'file:///workspace/web',
    });
  });

  it('rejects edit targets whose existing parent resolves outside the workspace', async () => {
    realpathEnvironment.paths.set('/workspace/web/link', '/outside');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.preview({
        summary: 'Create through link',
        files: [{ path: 'link/file.ts', operation: 'create', content: 'export {};\n' }],
      }),
    ).rejects.toThrow(/outside the selected workspace/iu);
  });

  it('rejects a command working directory that resolves outside the workspace', async () => {
    realpathEnvironment.paths.set('/workspace/web/out', '/outside');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.execute(
        { command: 'npm test', cwd: 'out', purpose: 'Run tests' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the selected workspace/iu);
  });

  it('parses quoted assignment paths before checking their canonical target', async () => {
    realpathEnvironment.paths.set(path.resolve('/workspace/web', 'out link'), '/outside');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.execute(
        { command: 'npm --prefix="out link" test', purpose: 'Run nested tests' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the selected workspace/iu);
  });

  it('revalidates every reviewed file after preparing a multi-file edit', async () => {
    const first = '/workspace/web/src/a.ts';
    const second = '/workspace/web/src/b.ts';
    vscodeEnvironment.files.set(first, 'export const a = 1;\n');
    vscodeEnvironment.files.set(second, 'export const b = 1;\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Update both files',
      files: [
        { path: 'src/a.ts', operation: 'update' as const, content: 'export const a = 2;\n' },
        { path: 'src/b.ts', operation: 'update' as const, content: 'export const b = 2;\n' },
      ],
    };
    const review = await adapter.preview(plan);
    vscodeEnvironment.onRead = (path) => {
      if (path === second) {
        vscodeEnvironment.files.set(first, 'export const userEdit = true;\n');
      }
    };

    await expect(adapter.applyAtomically(plan, review)).rejects.toThrow(/changed during review/iu);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('stops a cancelled request immediately before the atomic workspace commit', async () => {
    const target = '/workspace/web/src/app.ts';
    vscodeEnvironment.files.set(target, 'export const value = 1;\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Update value',
      files: [
        {
          path: 'src/app.ts',
          operation: 'update' as const,
          content: 'export const value = 2;\n',
        },
      ],
    };
    const review = await adapter.preview(plan);
    let releaseRead: (() => void) | undefined;
    const readBlocked = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    let revalidationStarted: (() => void) | undefined;
    const revalidating = new Promise<void>((resolve) => {
      revalidationStarted = resolve;
    });
    vscodeEnvironment.onRead = async () => {
      revalidationStarted?.();
      await readBlocked;
    };
    const controller = new AbortController();
    const cancellation = new Error('Workspace changed.');

    const applying = adapter.applyAtomically(plan, review, controller.signal);
    await revalidating;
    controller.abort(cancellation);
    releaseRead?.();

    await expect(applying).rejects.toBe(cancellation);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('terminates a command when cancellation arrives while the task is launching', async () => {
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    let finishLaunch: ((execution: vscode.TaskExecution) => void) | undefined;
    const execution = { task: {} as vscode.Task, terminate: vi.fn() };
    vi.mocked(vscode.tasks.executeTask).mockReturnValueOnce(
      new Promise((resolve) => {
        finishLaunch = resolve;
      }),
    );
    const controller = new AbortController();
    const cancellation = new Error('Account changed.');

    const running = adapter.execute(
      { command: 'npm test', purpose: 'Run tests' },
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(vscode.tasks.executeTask).toHaveBeenCalledOnce();
    });
    controller.abort(cancellation);
    finishLaunch?.(execution);

    await expect(running).rejects.toBeDefined();
    expect(execution.terminate).toHaveBeenCalledOnce();
  });

  it('refuses undo after the user changes an applied file', async () => {
    const target = '/workspace/web/src/app.ts';
    vscodeEnvironment.files.set(target, 'export const value = "A";\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Update value',
      files: [
        {
          path: 'src/app.ts',
          operation: 'update' as const,
          content: 'export const value = "B";\n',
        },
      ],
    };
    const review = await adapter.preview(plan);
    await adapter.applyAtomically(plan, review);
    vscodeEnvironment.files.set(target, 'export const value = "C";\n');
    vi.mocked(vscode.workspace.applyEdit).mockClear();

    await expect(adapter.undoLast()).resolves.toBe(false);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    expect(vscodeEnvironment.files.get(target)).toContain('"C"');
  });

  it('refuses undo after the selected workspace root changes', async () => {
    const target = '/workspace/web/src/app.ts';
    vscodeEnvironment.files.set(target, 'export const value = "A";\n');
    let selectedFolder = '/workspace/web';
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file(selectedFolder) }),
    });
    const plan = {
      summary: 'Update value',
      files: [
        {
          path: 'src/app.ts',
          operation: 'update' as const,
          content: 'export const value = "B";\n',
        },
      ],
    };
    const review = await adapter.preview(plan);
    await adapter.applyAtomically(plan, review);
    selectedFolder = '/workspace/other';
    vi.mocked(vscode.workspace.applyEdit).mockClear();

    await expect(adapter.undoLast()).resolves.toBe(false);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});
