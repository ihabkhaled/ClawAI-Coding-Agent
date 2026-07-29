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

  it('rejects reviews whose file count, path, or approved content differs from the plan', async () => {
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

    await expect(adapter.applyAtomically(plan, { ...review, previews: [] })).rejects.toThrow(
      /reviewed file changes are no longer available/iu,
    );
    await expect(
      adapter.applyAtomically(plan, {
        ...review,
        previews: [{ ...review.previews[0], path: 'src/other.ts' }] as never,
      }),
    ).rejects.toThrow(/reviewed file changes are no longer available/iu);
    await expect(
      adapter.applyAtomically(plan, {
        ...review,
        previews: [{ ...review.previews[0], after: 'unapproved content' }] as never,
      }),
    ).rejects.toThrow(/reviewed file changes are no longer available/iu);

    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('does not retain an undo backup when the editor rejects an atomic create', async () => {
    vscodeEnvironment.appliedResult = false;
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Create empty file',
      files: [{ path: 'src/empty.ts', operation: 'create' as const }],
    };
    const review = await adapter.preview(plan);

    await expect(adapter.applyAtomically(plan, review)).resolves.toBe(false);
    await expect(adapter.undoLast()).resolves.toBe(false);

    expect(vscodeEnvironment.appliedEdit?.creates).toEqual([
      { content: '', path: '/workspace/web/src/empty.ts' },
    ]);
  });

  it('uses an empty replacement when an approved update omits content', async () => {
    const target = '/workspace/web/src/app.ts';
    vscodeEnvironment.files.set(target, 'export const value = 1;\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Clear file',
      files: [{ path: 'src/app.ts', operation: 'update' as const }],
    };
    const review = await adapter.preview(plan);

    await expect(adapter.applyAtomically(plan, review)).resolves.toBe(true);
    expect(vscodeEnvironment.appliedEdit?.replacements).toEqual([{ content: '', path: target }]);
  });

  it('invalidates approval when a watched editor buffer changes during application', async () => {
    const target = vscode.Uri.file('/workspace/web/src/app.ts');
    vscodeEnvironment.files.set(target.path, 'export const value = 1;\n');
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
    vscodeEnvironment.onRead = () => {
      vscodeEnvironment.changeListener?.({
        document: { uri: vscode.Uri.file('/workspace/web/src/unrelated.ts') },
      });
      vscodeEnvironment.changeListener?.({ document: { uri: target } });
    };

    await expect(adapter.applyAtomically(plan, review)).rejects.toThrow(/changed during review/iu);
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });

  it('undoes a mixed create, delete, and update as one inverse workspace edit', async () => {
    const created = '/workspace/web/src/created.ts';
    const deleted = '/workspace/web/src/deleted.ts';
    const updated = '/workspace/web/src/updated.ts';
    vscodeEnvironment.files.set(deleted, 'export const deleted = true;\n');
    vscodeEnvironment.files.set(updated, 'export const value = 1;\n');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const plan = {
      summary: 'Apply mixed changes',
      files: [
        {
          path: 'src/created.ts',
          operation: 'create' as const,
          content: 'export const created = true;\n',
        },
        { path: 'src/deleted.ts', operation: 'delete' as const },
        {
          path: 'src/updated.ts',
          operation: 'update' as const,
          content: 'export const value = 2;\n',
        },
      ],
    };
    const review = await adapter.preview(plan);
    await adapter.applyAtomically(plan, review);
    vscodeEnvironment.files.set(created, 'export const created = true;\n');
    vscodeEnvironment.files.delete(deleted);
    vscodeEnvironment.files.set(updated, 'export const value = 2;\n');

    await expect(adapter.undoLast()).resolves.toBe(true);

    expect(vscodeEnvironment.appliedEdit?.deletes).toEqual([{ path: created }]);
    expect(vscodeEnvironment.appliedEdit?.creates).toEqual([
      { content: 'export const deleted = true;\n', path: deleted },
    ]);
    expect(vscodeEnvironment.appliedEdit?.replacements).toEqual([
      { content: 'export const value = 1;\n', path: updated },
    ]);
    await expect(adapter.undoLast()).resolves.toBe(false);
  });

  it('retains the backup when VS Code rejects the inverse undo edit', async () => {
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
    await adapter.applyAtomically(plan, review);
    vscodeEnvironment.files.set(target, 'export const value = 2;\n');
    vscodeEnvironment.appliedResult = false;

    await expect(adapter.undoLast()).resolves.toBe(false);

    vscodeEnvironment.appliedResult = true;
    await expect(adapter.undoLast()).resolves.toBe(true);
  });

  it('refuses undo when trust is revoked or selected-folder lookup fails', async () => {
    const target = '/workspace/web/src/app.ts';
    vscodeEnvironment.files.set(target, 'export const value = 1;\n');
    let folderLookupFails = false;
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => {
        if (folderLookupFails) {
          throw new Error('No selected folder');
        }
        return { uri: vscode.Uri.file('/workspace/web') };
      },
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
    await adapter.applyAtomically(plan, review);
    vscodeEnvironment.files.set(target, 'export const value = 2;\n');

    Object.defineProperty(vscode.workspace, 'isTrusted', {
      configurable: true,
      value: false,
      writable: true,
    });
    await expect(adapter.undoLast()).resolves.toBe(false);

    Object.defineProperty(vscode.workspace, 'isTrusted', {
      configurable: true,
      value: true,
      writable: true,
    });
    folderLookupFails = true;
    await expect(adapter.undoLast()).resolves.toBe(false);
  });
});
