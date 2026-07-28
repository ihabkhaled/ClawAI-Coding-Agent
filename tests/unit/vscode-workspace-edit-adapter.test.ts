import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const vscodeEnvironment = vi.hoisted(() => ({
  appliedEdit: undefined as
    | {
        creates: string[];
        inserts: { path: string; content: string }[];
      }
    | undefined,
}));

vi.mock('vscode', () => {
  class FileSystemError extends Error {
    code = 'FileNotFound';
  }
  class WorkspaceEdit {
    readonly creates: string[] = [];
    readonly inserts: { path: string; content: string }[] = [];
    createFile(uri: { path: string }): void {
      this.creates.push(uri.path);
    }
    insert(uri: { path: string }, _position: unknown, content: string): void {
      this.inserts.push({ path: uri.path, content });
    }
  }
  return {
    FileSystemError,
    Position: class Position {
      constructor(
        readonly line: number,
        readonly character: number,
      ) {}
    },
    Uri: {
      file: (path: string) => ({ path }),
      joinPath: (base: { path: string }, ...parts: string[]) => ({
        path: [base.path, ...parts].join('/'),
      }),
    },
    WorkspaceEdit,
    workspace: {
      applyEdit: vi.fn(async (edit: InstanceType<typeof WorkspaceEdit>) => {
        vscodeEnvironment.appliedEdit = edit;
        return true;
      }),
      fs: {
        readFile: vi.fn(async () => {
          throw new FileSystemError();
        }),
      },
      isTrusted: true,
      openTextDocument: vi.fn(),
      workspaceFolders: [{ name: 'api', uri: { path: '/workspace/api' } }],
    },
  };
});

import { VscodeWorkspaceEditAdapter } from '../../src/infrastructure/vscode-workspace-edit-adapter';

describe('VscodeWorkspaceEditAdapter workspace scope', () => {
  beforeEach(() => {
    vscodeEnvironment.appliedEdit = undefined;
  });

  it('creates files under the explicitly selected folder instead of workspace index zero', async () => {
    const adapter = new VscodeWorkspaceEditAdapter({
      selectedFolder: () => ({ uri: vscode.Uri.file('/workspace/web') }),
    });

    await expect(
      adapter.applyAtomically({
        summary: 'Create loop',
        files: [
          {
            path: 'app/for-loop.js',
            operation: 'create',
            content: 'for (let i = 1; i <= 10; i += 1) {}\n',
          },
        ],
      }),
    ).resolves.toBe(true);
    expect(vscodeEnvironment.appliedEdit).toEqual(
      expect.objectContaining({
        creates: ['/workspace/web/app/for-loop.js'],
        inserts: [
          {
            path: '/workspace/web/app/for-loop.js',
            content: 'for (let i = 1; i <= 10; i += 1) {}\n',
          },
        ],
      }),
    );
  });
});
