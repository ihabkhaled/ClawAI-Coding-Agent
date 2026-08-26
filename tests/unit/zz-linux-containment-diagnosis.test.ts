// TEMPORARY diagnostic. The large-read tests fail on the Linux runner and pass
// on Windows, and reading the source has not explained why. This mirrors their
// setup exactly and logs every path the adapter actually sees. Delete once the
// cause is known.
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => {
    console.error('DIAG realpath called with =', JSON.stringify(value));
    return value;
  }),
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
      file: (fsPath: string) => {
        console.error('DIAG Uri.file =', JSON.stringify(fsPath));
        return uri(fsPath);
      },
      joinPath: (base: { fsPath: string }, ...parts: string[]) => {
        const joined = [base.fsPath, ...parts].join(path.sep);
        console.error(
          'DIAG Uri.joinPath base =',
          JSON.stringify(base.fsPath),
          'parts =',
          JSON.stringify(parts),
          '=>',
          JSON.stringify(joined),
        );
        return uri(joined);
      },
    },
    workspace: {
      asRelativePath: (value: { path: string }) => value.path,
      findFiles: vi.fn(async () => []),
      fs: {
        readDirectory: vi.fn(async () => []),
        readFile: vi.fn(async () => new TextEncoder().encode('x')),
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

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

describe('DIAGNOSIS: what the adapter sees on this platform', () => {
  it('logs the whole chain', async () => {
    const workspaceRoot = path.resolve(path.sep, 'workspace');
    console.error('DIAG platform =', process.platform);
    console.error('DIAG path.sep =', JSON.stringify(path.sep));
    console.error('DIAG workspaceRoot =', JSON.stringify(workspaceRoot));

    const adapter = new VscodeFileTransactionAdapter();
    adapter.registerRuntimeRoot('workspace-1', workspaceRoot);
    const executor = new VscodeFilesystemToolExecutor(
      adapter,
      new FileTransactionService(adapter),
    );
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1 } as never);

    const invocation: ToolInvocation = {
      schemaVersion: '2.0',
      invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
      turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
      toolName: 'workspace.files',
      toolVersion: '2.0.0',
      operation: 'read',
      arguments: { rootKey: 'workspace-1', path: 'src/lib/i18n/locales/en.ts' },
      targetId: 'target:workspace',
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
      requestedAt: '2026-08-08T16:07:37.239Z',
    };

    try {
      const output = await executor.execute(invocation);
      console.error('DIAG read SUCCEEDED, truncated =', output.structured?.truncated);
    } catch (error) {
      console.error('DIAG read THREW =', (error as Error).message);
    }

    expect(true).toBe(true);
  });
});
