import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// Containment is decided with node:path, whose separator is platform-native.
// A hard-coded 'C:\workspace' passes on Windows and fails on a Linux runner,
// where a backslash is an ordinary filename character rather than a separator:
// path.relative() then yields '../C:\workspace\...' and the guard correctly
// reports an escape. Building the root and its joins from path.sep keeps the
// test exercising the read behaviour it is about on both platforms.
const WORKSPACE_ROOT = path.resolve(path.sep, 'workspace');

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
  class FileSystemError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    FileType: { File: 1, Directory: 2 },
    FileSystemError,
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
      asRelativePath: (value: { path: string }) =>
        value.path.replace(`${WORKSPACE_ROOT.replaceAll('\\', '/')}/`, ''),
      findFiles: vi.fn(async () => []),
      fs: {
        readDirectory: vi.fn(async () => []),
        readFile: vi.fn(async () => new TextEncoder().encode('')),
        stat: vi.fn(async () => ({ type: 1 })),
      },
      textDocuments: [],
      workspaceFolders: [],
    },
  };
});

import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';
import { VscodeFilesystemToolExecutor } from '../../src/infrastructure/vscode-filesystem-tool-executor';
import { FileTransactionService } from '../../src/services/file-transaction-service';
import { isRuntimeToolExecutionOutputValid } from '../../src/services/runtime-tool-dispatcher';

import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';

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

// A locale file in the ClawAI monorepo. 5_409 lines, ~200 kB — well past the
// 65_536-character Runtime V2 string cap that a default read used to blow.
function hugeFile(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_line, index) => `  key${String(index)}: 'value',`,
  ).join('\n');
}

describe('reading a file larger than the Runtime V2 string cap', () => {
  let executor: VscodeFilesystemToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    const adapter = new VscodeFileTransactionAdapter();
    adapter.registerRuntimeRoot('workspace-1', 'C:\\workspace');
    executor = new VscodeFilesystemToolExecutor(adapter, new FileTransactionService(adapter));
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1 } as never);
  });

  it('returns a valid bounded page instead of failing the whole read', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(hugeFile(6_000)),
    );

    const output = await executor.execute(
      invocation('read', { rootKey: 'workspace-1', path: 'src/lib/i18n/locales/en.ts' }),
    );

    // The regression: this used to be false, so the dispatcher answered
    // TOOL_OUTPUT_INVALID and the file could never be read — or patched.
    expect(isRuntimeToolExecutionOutputValid(output)).toBe(true);
    expect(output.structured).toMatchObject({ truncated: true, totalLines: 6_000 });
    expect(String(output.structured?.content).length).toBeLessThanOrEqual(65_536);
  });

  it('still reports the whole-file hash so a ranged read can anchor a patch', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(hugeFile(6_000)),
    );

    const page = await executor.execute(
      invocation('read', {
        rootKey: 'workspace-1',
        path: 'src/lib/i18n/locales/en.ts',
        startLine: 5_900,
      }),
    );
    const whole = await executor.execute(
      invocation('read', { rootKey: 'workspace-1', path: 'src/lib/i18n/locales/en.ts' }),
    );

    expect(page.structured?.hash).toBe(whole.structured?.hash);
    expect(String(page.structured?.hash)).toMatch(/^sha256:/u);
  });

  it('hands back a nextStartLine so the model can page to the end', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(hugeFile(6_000)),
    );

    const output = await executor.execute(
      invocation('read', { rootKey: 'workspace-1', path: 'src/lib/i18n/locales/en.ts' }),
    );

    const nextStartLine = Number(output.structured?.nextStartLine);
    expect(nextStartLine).toBeGreaterThan(1);
    expect(nextStartLine).toBe(Number(output.structured?.endLine) + 1);
  });

  it('truncates on a line boundary so every delivered line is complete', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode(hugeFile(6_000)),
    );

    const output = await executor.execute(
      invocation('read', { rootKey: 'workspace-1', path: 'src/lib/i18n/locales/en.ts' }),
    );

    for (const line of String(output.structured?.content).split('\n')) {
      expect(line).toMatch(/^ {2}key\d+: 'value',$/u);
    }
  });
});

describe('filesystem tool error messages a model can act on', () => {
  let executor: VscodeFilesystemToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    const adapter = new VscodeFileTransactionAdapter();
    adapter.registerRuntimeRoot('workspace-1', 'C:\\workspace');
    executor = new VscodeFilesystemToolExecutor(adapter, new FileTransactionService(adapter));
  });

  it('says a missing file is missing, not "not readable text"', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockRejectedValue(
      new (vscode as unknown as { FileSystemError: new (code: string) => Error }).FileSystemError(
        'FileNotFound',
      ),
    );

    await expect(
      executor.execute(
        invocation('read', { rootKey: 'workspace-1', path: 'src/does-not-exist.ts' }),
      ),
    ).rejects.toThrow(/No such file: src\/does-not-exist\.ts/u);
  });

  it('names the real rule when a transaction carries several operations', async () => {
    const operations = Array.from({ length: 4 }, (_item, index) => ({
      kind: 'create',
      rootKey: 'workspace-1',
      path: `src/file-${String(index)}.ts`,
      contentLines: ['export const value = 1;'],
    }));

    await expect(
      executor.execute(
        invocation('create', {
          transaction: { transactionId: 'tx-1', summary: 'four files', operations },
        }),
      ),
    ).rejects.toThrow(/exactly one operation, got 4/u);
  });
});
