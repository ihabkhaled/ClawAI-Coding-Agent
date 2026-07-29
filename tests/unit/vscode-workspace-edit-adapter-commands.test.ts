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

  it('rejects a command before launch when it is already cancelled or has an open quote', async () => {
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      adapter.execute({ command: 'npm test', purpose: 'Run tests' }, controller.signal),
    ).rejects.toThrow('ClawAI command execution was cancelled.');
    await expect(
      adapter.execute(
        { command: 'npm --prefix="unterminated test', purpose: 'Run tests' },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/outside the selected workspace/iu);

    expect(vscode.tasks.executeTask).not.toHaveBeenCalled();
  });

  it('ignores unrelated task completions and resolves with the owned task exit code', async () => {
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });
    const execution = { task: {} as vscode.Task, terminate: vi.fn() };
    vi.mocked(vscode.tasks.executeTask).mockResolvedValueOnce(execution);

    const running = adapter.execute(
      { command: 'npm  --silent ', cwd: '.', purpose: 'Run tests' },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(vscodeEnvironment.taskEndListener).toBeTypeOf('function');
    });
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    vscodeEnvironment.taskEndListener?.({
      execution: { task: {} },
      exitCode: 99,
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    vscodeEnvironment.taskEndListener?.({ execution, exitCode: 7 });
    await expect(running).resolves.toEqual({ exitCode: 7 });
    expect(execution.terminate).not.toHaveBeenCalled();
  });

  it('allows non-file workspace schemes without applying filesystem realpath policy', async () => {
    const virtualUri = {
      fsPath: '/virtual/workspace',
      path: '/virtual/workspace',
      scheme: 'vscode-vfs',
      toString: () => 'vscode-vfs:///virtual/workspace',
    } as never;
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: virtualUri }),
    });

    await expect(
      adapter.preview({
        summary: 'Create virtual file',
        files: [{ path: 'src/app.ts', operation: 'create', content: 'export {};\n' }],
      }),
    ).resolves.toMatchObject({
      previews: [{ after: 'export {};\n', before: null, path: 'src/app.ts' }],
    });
  });

  it('executes tasks in a non-file workspace without filesystem command-path checks', async () => {
    const virtualUri = {
      fsPath: '/virtual/workspace',
      path: '/virtual/workspace',
      scheme: 'vscode-vfs',
      toString: () => 'vscode-vfs:///virtual/workspace',
    } as never;
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: virtualUri }),
    });
    const execution = { task: {} as vscode.Task, terminate: vi.fn() };
    vi.mocked(vscode.tasks.executeTask).mockResolvedValueOnce(execution);

    const running = adapter.execute(
      { command: 'tool ../../outside', purpose: 'Run virtual task' },
      new AbortController().signal,
    );
    await vi.waitFor(() => {
      expect(vscodeEnvironment.taskEndListener).toBeTypeOf('function');
    });
    vscodeEnvironment.taskEndListener?.({ execution, exitCode: 0 });

    await expect(running).resolves.toEqual({ exitCode: 0 });
  });

  it('walks to an existing parent for a new nested file and rethrows unexpected realpath errors', async () => {
    const missing = Object.assign(new Error('missing path'), { code: 'ENOENT' });
    realpathEnvironment.errors.set('/workspace/web/missing/deep', missing);
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.preview({
        summary: 'Create nested file',
        files: [
          {
            path: 'missing/deep/app.ts',
            operation: 'create',
            content: 'export {};\n',
          },
        ],
      }),
    ).resolves.toMatchObject({
      previews: [{ before: null, path: 'missing/deep/app.ts' }],
    });

    const notDirectory = Object.assign(new Error('not a directory'), {
      code: 'ENOTDIR',
    });
    realpathEnvironment.errors.clear();
    realpathEnvironment.errors.set('/workspace/web/blocked/deep', notDirectory);
    await expect(
      adapter.preview({
        summary: 'Create below a non-directory candidate',
        files: [
          {
            path: 'blocked/deep/app.ts',
            operation: 'create',
            content: 'export {};\n',
          },
        ],
      }),
    ).resolves.toMatchObject({
      previews: [{ before: null, path: 'blocked/deep/app.ts' }],
    });

    realpathEnvironment.errors.clear();
    realpathEnvironment.errors.set('/workspace/web/src', new Error('realpath failed'));
    await expect(
      adapter.preview({
        summary: 'Create with failed canonicalization',
        files: [{ path: 'src/app.ts', operation: 'create', content: 'export {};\n' }],
      }),
    ).rejects.toThrow('realpath failed');
  });

  it('rethrows filesystem read failures that are not missing-file results', async () => {
    vscodeEnvironment.readError = new Error('disk unavailable');
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.preview({
        summary: 'Read existing file',
        files: [{ path: 'src/app.ts', operation: 'update', content: 'export {};\n' }],
      }),
    ).rejects.toThrow('disk unavailable');
  });
});
