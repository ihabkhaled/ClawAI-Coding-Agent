import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => value),
}));

vi.mock('vscode', () => {
  const uri = (fsPath: string) => ({
    fsPath,
    path: fsPath.replaceAll('\\', '/'),
    scheme: 'file',
    toString: () => `file:///${fsPath.replaceAll('\\', '/')}`,
  });
  return {
    FileType: { File: 1 },
    RelativePattern: class RelativePattern {
      constructor(
        readonly base: { fsPath: string },
        readonly pattern: string,
      ) {}
    },
    Uri: {
      file: uri,
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        uri([base.fsPath, ...parts].join('\\')),
    },
    workspace: {
      asRelativePath: (value: { path: string }) => value.path.replace('C:/workspace/', ''),
      findFiles: vi.fn(async () => []),
      fs: {
        readDirectory: vi.fn(async () => []),
        readFile: vi.fn(async () => new TextEncoder().encode('needle')),
      },
      textDocuments: [],
      workspaceFolders: [],
    },
  };
});

import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';
import { VscodeFilesystemToolExecutor } from '../../src/infrastructure/vscode-filesystem-tool-executor';
import { FileTransactionService } from '../../src/services/file-transaction-service';

import type { RuntimeJsonObject } from '../../src/core/runtime/runtime-tool-contracts';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

function invocation(operation: string, arguments_: RuntimeJsonObject): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: 'workspace.files',
    toolVersion: '2.0.0',
    operation,
    arguments: arguments_,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-08-08T16:07:37.239Z',
  };
}

describe('VS Code filesystem tool result bounds', () => {
  let executor: VscodeFilesystemToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    const adapter = new VscodeFileTransactionAdapter();
    adapter.registerRuntimeRoot('workspace-1', 'C:\\workspace');
    executor = new VscodeFilesystemToolExecutor(adapter, new FileTransactionService(adapter));
  });

  it('paginates a default directory listing at the Runtime V2 collection limit', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue(
      Array.from({ length: 150 }, (_entry, index) => [
        `file-${String(index)}.ts`,
        vscode.FileType.File,
      ]),
    );

    const output = await executor.execute(invocation('list', { rootKey: 'workspace-1', path: '' }));
    const entries = output.structured?.entries;

    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(100);
    expect(output.structured).toMatchObject({ nextCursor: 100, total: 150 });
  });

  it.each([
    ['glob', { rootKey: 'workspace-1', pattern: '**/*.ts' }],
    ['search', { rootKey: 'workspace-1', pattern: '**/*.ts', query: 'needle' }],
  ] as const)('caps default %s discovery output at 100 results', async (operation, arguments_) => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(
      Array.from({ length: 150 }, (_entry, index) =>
        vscode.Uri.file(`C:\\workspace\\file-${String(index)}.ts`),
      ),
    );

    const output = await executor.execute(invocation(operation, arguments_));
    const results = operation === 'glob' ? output.structured?.paths : output.structured?.results;

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(expect.anything(), undefined, 100);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(100);
    expect(output.structured).toMatchObject({ truncated: true });
  });

  it('reports a saturated search candidate set even when fewer lines match', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(
      Array.from({ length: 100 }, (_entry, index) =>
        vscode.Uri.file(`C:\\workspace\\file-${String(index)}.ts`),
      ),
    );
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('no matching text'),
    );

    const output = await executor.execute(
      invocation('search', {
        rootKey: 'workspace-1',
        pattern: '**/*.ts',
        query: 'needle',
      }),
    );

    expect(output.structured).toMatchObject({ results: [], truncated: true });
  });

  it.each([
    ['list', { rootKey: 'workspace-1', path: '', limit: 101 }],
    ['glob', { rootKey: 'workspace-1', pattern: '**/*.ts', maxResults: 101 }],
    ['search', { rootKey: 'workspace-1', pattern: '**/*.ts', query: 'needle', maxResults: 101 }],
  ] as const)('rejects %s requests above the result envelope', async (operation, arguments_) => {
    await expect(executor.execute(invocation(operation, arguments_))).rejects.toThrow(/100/u);
  });
});
