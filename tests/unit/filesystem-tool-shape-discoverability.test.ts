import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({ realpath: vi.fn(async (value: string) => value) }));

vi.mock('vscode', () => ({
  FileType: { File: 1, Directory: 2 },
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: { fsPath: string },
      readonly pattern: string,
    ) {}
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath, path: fsPath, scheme: 'file', toString: () => fsPath }),
    joinPath: (base: { fsPath: string }) => base,
  },
  workspace: {
    asRelativePath: (value: { path: string }) => value.path,
    findFiles: vi.fn(async () => []),
    fs: { readDirectory: vi.fn(async () => []), readFile: vi.fn(async () => new Uint8Array()) },
    textDocuments: [],
    workspaceFolders: [],
  },
}));

import { fileTransactionOperationSchema } from '../../src/core/file-transaction';
import { workspaceFilesystemToolDefinition } from '../../src/infrastructure/vscode-filesystem-tool-executor';

const description = workspaceFilesystemToolDefinition.description;

// Derived from the schema rather than hard-coded, so adding a new mutation kind
// without documenting it fails here instead of in a live run.
const mutationKinds = fileTransactionOperationSchema.options.flatMap((option) => {
  const kind = option.shape.kind;
  return 'value' in kind ? [kind.value] : [...kind.options];
});

// The transaction shape reaches the model through one channel only: this
// description. The nested transaction is reported to the model as an empty
// object, so an operation the description does not spell out is an operation
// the model has to guess — and guessing loses runs.
//
// A live mission tried to patch a file three times, as "content":"PATCH\n@@ …",
// as "patch":"@@ …", and as "content":"@@ …", because nothing said patch takes
// exact hunks instead of a unified diff. All three failed and the model fell
// back to a whole-file update that silently deleted forty comments.
describe('the filesystem catalog documents every kind it advertises', () => {
  it('covers the whole mutation union', () => {
    expect(mutationKinds).toEqual(
      expect.arrayContaining([
        'create',
        'update',
        'patch',
        'rename',
        'copy',
        'delete',
        'mkdir',
        'artifact',
      ]),
    );
  });

  it.each(mutationKinds)('names the %s kind so the model never has to guess it', (kind) => {
    expect(description).toContain(kind);
  });

  it('teaches patch as exact hunks rather than a diff', () => {
    // These three facts are exactly what the failing run needed and did not have.
    expect(description).toContain('hunks');
    expect(description).toContain('"before"');
    expect(description).toContain('"after"');
    expect(description).toMatch(/not a diff/i);
    expect(description).toMatch(/exactly once/i);
  });

  it('warns that update replaces the whole file', () => {
    expect(description).toMatch(/replaces the whole file/i);
  });
});
