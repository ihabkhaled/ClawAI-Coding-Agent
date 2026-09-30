import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  const outputLines: string[] = [];
  const stub = (): unknown => {
    const target = function stubTarget(): undefined {
      return undefined;
    };
    const proxy: unknown = new Proxy(target, {
      get: (_t, key) => (key === 'then' || key === Symbol.toPrimitive ? undefined : proxy),
      apply: () => proxy,
      construct: () => proxy as object,
      set: () => true,
    });
    return proxy;
  };
  // Any member the test does not name is an inert stub, so a new registration
  // call in activate() does not break this test; a timer, socket or process
  // it starts is still caught by the spies below.
  const withStubs = <T extends object>(known: T): T =>
    new Proxy(known, {
      get: (target, key) => (key in target ? Reflect.get(target, key) : stub()),
    });
  const memento = {
    get: (_key: string, fallback?: unknown) => fallback,
    update: () => Promise.resolve(),
    keys: () => [] as string[],
    setKeysForSync: () => undefined,
  };
  const noopDisposable = { dispose: () => undefined };
  const configuration = {
    get: (_key: string, fallback?: unknown) => fallback,
    has: () => false,
    inspect: () => undefined,
    update: () => Promise.resolve(),
  };
  class Emitter {
    readonly event = (): { dispose(): void } => noopDisposable;
    fire(): void {
      return undefined;
    }
    dispose(): void {
      return undefined;
    }
  }
  class Disposable {
    constructor(private readonly callback: () => void = () => undefined) {}
    dispose(): void {
      this.callback();
    }
    static from(...items: { dispose(): void }[]): Disposable {
      return new Disposable(() => {
        for (const item of items) item.dispose();
      });
    }
  }
  const uri = (path: string) => ({
    fsPath: path,
    path,
    scheme: 'file',
    toString: () => path,
    with: () => uri(path),
  });
  const window = {
    createOutputChannel: () => ({
      appendLine: (line: string) => outputLines.push(line),
      show: () => undefined,
      dispose: () => undefined,
    }),
    createStatusBarItem: () => stub(),
    createTerminal: () => {
      throw new Error('activate() must not open a terminal');
    },
    onDidChangeActiveTextEditor: () => noopDisposable,
    onDidChangeTextEditorSelection: () => noopDisposable,
    onDidChangeVisibleTextEditors: () => noopDisposable,
    onDidCloseTerminal: () => noopDisposable,
    onDidOpenTerminal: () => noopDisposable,
    terminals: [],
    registerWebviewViewProvider: () => noopDisposable,
    registerUriHandler: () => noopDisposable,
    registerTreeDataProvider: () => noopDisposable,
    createTreeView: () => stub(),
    showInformationMessage: () => Promise.resolve(undefined),
  };
  const workspace = {
    isTrusted: true,
    workspaceFolders: undefined,
    getConfiguration: () => configuration,
    asRelativePath: (path: string) => path,
    onDidChangeConfiguration: () => noopDisposable,
    onDidGrantWorkspaceTrust: () => noopDisposable,
    onDidChangeWorkspaceFolders: () => noopDisposable,
    onDidSaveTextDocument: () => noopDisposable,
    onDidChangeTextDocument: () => noopDisposable,
    createFileSystemWatcher: () => {
      throw new Error('activate() must not create a file system watcher');
    },
  };
  const commands = {
    registerCommand: () => noopDisposable,
    executeCommand: () => Promise.resolve(undefined),
  };
  const stubbed = [
    'TreeItem',
    'FileSystemError',
    'ConfigurationTarget',
    'ThemeIcon',
    'FileType',
    'RelativePattern',
    'Range',
    'TreeItemCollapsibleState',
    'Position',
    'tasks',
    'WorkspaceEdit',
    'ProgressLocation',
    'ViewColumn',
    'UIKind',
    'NotebookCellKind',
    'ExtensionMode',
    'DiagnosticSeverity',
    'languages',
    'extensions',
    'chat',
    'ThemeColor',
    'StatusBarAlignment',
    'MarkdownString',
    'FileChangeType',
    'ExtensionKind',
    'ShellExecution',
    'Task',
    'TaskScope',
    'Hover',
    'Diagnostic',
  ];
  const members: Record<string, unknown> = {
    ...Object.fromEntries(stubbed.map((name) => [name, stub()])),
    EventEmitter: Emitter,
    Disposable,
    LogLevel: { Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5, Off: 0 },
    Uri: {
      file: uri,
      parse: uri,
      joinPath: (base: { path: string }, ...parts: string[]) =>
        uri([base.path, ...parts].join('/')),
    },
    l10n: { t: (message: string) => message },
    env: { logLevel: 2, language: 'en', appName: 'Code', machineId: 'm', sessionId: 's' },
    version: '1.100.0',
    window: withStubs(window),
    workspace: withStubs(workspace),
    commands: withStubs(commands),
  };
  const vscode = { ...members, default: members };
  return { vscode, memento, outputLines };
});

const processSpies = vi.hoisted(() => ({
  spawn: vi.fn(),
  createServer: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('vscode', () => host.vscode);
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawn: processSpies.spawn,
}));
vi.mock('node:net', async (importOriginal) => ({
  ...(await importOriginal<typeof Net>()),
  createServer: processSpies.createServer,
  connect: processSpies.connect,
}));
vi.mock('node:http', async (importOriginal) => ({
  ...(await importOriginal<typeof Http>()),
  createServer: processSpies.createServer,
}));

import { activate } from '../../src/extension';

import type * as ChildProcess from 'node:child_process';
import type * as Http from 'node:http';
import type * as Net from 'node:net';
import type * as vscode from 'vscode';

function fakeContext(): vscode.ExtensionContext {
  const subscriptions: { dispose(): unknown }[] = [];
  return {
    subscriptions,
    extensionMode: 1,
    extension: { extensionKind: 1 },
    extensionUri: { fsPath: '/ext', path: '/ext', scheme: 'file' },
    extensionPath: '/ext',
    globalStorageUri: { fsPath: '/global', path: '/global', scheme: 'file' },
    globalState: host.memento,
    workspaceState: host.memento,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      onDidChange: () => ({ dispose: () => undefined }),
    },
  } as never;
}

describe('activate() while signed out', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    vi.stubGlobal('fetch', fetchSpy);
    host.outputLines.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('starts no timer, socket, child process or network request', async () => {
    const context = fakeContext();

    activate(context);
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
    expect(processSpies.spawn).not.toHaveBeenCalled();
    expect(processSpies.createServer).not.toHaveBeenCalled();
    expect(processSpies.connect).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(context.subscriptions.length).toBeGreaterThan(10);
  });

  it('records its own cost at debug level only', async () => {
    activate(fakeContext());
    await vi.advanceTimersByTimeAsync(0);

    const marks = host.outputLines.filter((line) => line.includes('DEBUG activate:'));
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]).toMatch(/synchronous part \d+\.\d ms/u);
  });

  it('leaves no timer behind after everything is disposed', async () => {
    const context = fakeContext();
    activate(context);
    await vi.advanceTimersByTimeAsync(0);

    for (const subscription of context.subscriptions) subscription.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });
});
