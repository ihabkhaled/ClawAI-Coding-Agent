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
import {
  WORKSPACE_SCAN_EXCLUDE_GLOB,
  WORKSPACE_SEARCH_MAX_CANDIDATE_FILES,
} from '../../src/infrastructure/workspace-scan.constants';
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

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      operation === 'glob' ? 100 : WORKSPACE_SEARCH_MAX_CANDIDATE_FILES,
    );
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(100);
    expect(output.structured).toMatchObject({ truncated: true });
  });

  // `search` inherited `pattern` from the glob schema as required, so the
  // obvious call — search the workspace for this string — failed on a field
  // the tool description has no room to mention. Ten consecutive search calls
  // were lost to it in a live mission.
  it('searches the whole workspace when no narrowing pattern is given', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('const needle = 1;'),
    );

    const output = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle' }),
    );

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: '**/*' }),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      WORKSPACE_SEARCH_MAX_CANDIDATE_FILES,
    );
    expect(output.structured?.results).toEqual([
      { path: 'a.ts', line: 1, preview: 'const needle = 1;' },
    ]);
  });

  it('still honours an explicit narrowing pattern', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);

    await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle', pattern: 'src/**/*.ts' }),
    );

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'src/**/*.ts' }),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      WORKSPACE_SEARCH_MAX_CANDIDATE_FILES,
    );
  });

  // glob is the one operation whose entire purpose IS the pattern, so it must
  // keep demanding one rather than silently enumerating the workspace.
  it('still requires a pattern for glob', async () => {
    await expect(executor.execute(invocation('glob', { rootKey: 'workspace-1' }))).rejects.toThrow(
      /pattern/,
    );
  });

  it('reports a saturated search candidate set even when fewer lines match', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(
      Array.from({ length: WORKSPACE_SEARCH_MAX_CANDIDATE_FILES }, (_entry, index) =>
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

  // The candidate cap and the result cap used to be one number, so a hundred
  // files was both "all a search may open" and "all a model may be shown". A
  // search of a repository with thousands of files read about one percent of
  // it and reported nothing found, which reads exactly like proof of absence.
  it('scans far past the result cap and says how many files it opened', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(
      Array.from({ length: 400 }, (_entry, index) =>
        vscode.Uri.file(`C:\\workspace\\file-${String(index)}.ts`),
      ),
    );
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri: { path: string }) =>
      new TextEncoder().encode(uri.path.endsWith('file-399.ts') ? 'the needle' : 'nothing here'),
    );

    const output = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', pattern: '**/*.ts', query: 'needle' }),
    );

    expect(output.structured).toMatchObject({ scannedFiles: 400, truncated: false });
    expect(output.structured?.results).toEqual([
      { path: 'file-399.ts', line: 1, preview: 'the needle' },
    ]);
  });

  // Dependency and build output used to fill the answer, because findFiles does
  // not read .gitignore and the tool passed no exclude at all.
  it('excludes dependency and build output from discovery', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);

    await executor.execute(invocation('glob', { rootKey: 'workspace-1', pattern: '**/*.ts' }));

    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.anything(),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      100,
    );
  });

  it('treats the query as a literal unless regex is requested', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('config.get(key)'),
    );

    const literal = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'config.get(' }),
    );
    expect(literal.structured?.results).toHaveLength(1);

    const asRegex = await executor.execute(
      invocation('search', {
        rootKey: 'workspace-1',
        query: String.raw`config\.get\(\w+`,
        regex: true,
      }),
    );
    expect(asRegex.structured?.results).toHaveLength(1);
  });

  it('folds case only when asked', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('const Needle = 1;'),
    );

    const sensitive = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle' }),
    );
    expect(sensitive.structured?.results).toEqual([]);

    const folded = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle', ignoreCase: true }),
    );
    expect(folded.structured?.results).toHaveLength(1);
  });

  it('reports an unusable regex instead of silently finding nothing', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([]);

    await expect(
      executor.execute(
        invocation('search', { rootKey: 'workspace-1', query: '(unclosed', regex: true }),
      ),
    ).rejects.toThrow(/regex is not valid/);
  });

  it.each([
    ['list', { rootKey: 'workspace-1', path: '', limit: 101 }],
    ['glob', { rootKey: 'workspace-1', pattern: '**/*.ts', maxResults: 101 }],
    ['search', { rootKey: 'workspace-1', pattern: '**/*.ts', query: 'needle', maxResults: 101 }],
  ] as const)('rejects %s requests above the result envelope', async (operation, arguments_) => {
    await expect(executor.execute(invocation(operation, arguments_))).rejects.toThrow(/100/u);
  });

  // The two checks below used to share one message, "must contain exactly the
  // requested operation", for both a wrong operation count and a mismatched
  // kind. A model that copied the envelope's `operation` from an earlier,
  // unrelated call while correctly setting the new operation's `kind` got that
  // sentence back and had no way to see which of the two disagreed.
  it('names the actual count when a transaction holds more than one operation', async () => {
    await expect(
      executor.execute(
        invocation('create', {
          rootKey: 'workspace-1',
          path: 'a.ts',
          transaction: {
            transactionId: 'tx-two-ops',
            summary: 'two operations',
            operations: [
              {
                kind: 'create',
                rootKey: 'workspace-1',
                path: 'a.ts',
                content: '',
                beforeHash: null,
              },
              {
                kind: 'create',
                rootKey: 'workspace-1',
                path: 'b.ts',
                content: '',
                beforeHash: null,
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow(/exactly one operation, got 2/);
  });

  it('names both sides of an operation/kind mismatch', async () => {
    await expect(
      executor.execute(
        invocation('patch', {
          rootKey: 'workspace-1',
          path: 'a.ts',
          transaction: {
            transactionId: 'tx-mismatched-kind',
            summary: 'envelope says patch, operation says create',
            operations: [
              {
                kind: 'create',
                rootKey: 'workspace-1',
                path: 'a.ts',
                content: '',
                beforeHash: null,
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow(/operation "patch" must match transaction.operations\[0\].kind "create"/);
  });

  // Surrounding lines are what turn "this file mentions the symbol" into "this
  // is the definition", and reading them here saves a separate file read per
  // hit worth judging.
  it('returns the lines either side of a match when asked', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(['one', 'two', 'needle', 'four', 'five'].join('\n')),
    );

    const output = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle', contextLines: 2 }),
    );

    expect(output.structured?.results).toEqual([
      {
        path: 'a.ts',
        line: 3,
        preview: 'needle',
        context: { before: ['one', 'two'], after: ['four', 'five'] },
      },
    ]);
  });

  it('clamps context at the start and end of a file', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('needle'));

    const output = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle', contextLines: 5 }),
    );

    expect(output.structured?.results).toEqual([
      { path: 'a.ts', line: 1, preview: 'needle', context: { before: [], after: [] } },
    ]);
  });

  it('omits context entirely by default, so the result stays small', async () => {
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue([
      vscode.Uri.file('C:\\workspace\\a.ts'),
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(['one', 'needle', 'three'].join('\n')),
    );

    const output = await executor.execute(
      invocation('search', { rootKey: 'workspace-1', query: 'needle' }),
    );

    expect(output.structured?.results).toEqual([{ path: 'a.ts', line: 2, preview: 'needle' }]);
  });
});
