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
    Uri: { file: uri },
    workspace: { workspaceFolders: [] },
  };
});

import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';

function openFolders(...uris: vscode.Uri[]): void {
  Object.defineProperty(vscode.workspace, 'workspaceFolders', {
    configurable: true,
    value: uris.map((uri, index) => ({ index, name: `folder-${String(index + 1)}`, uri })),
  });
}

// `root()` — the file-operation path — learned to resolve the advertised
// `workspace-<n>` key, but `workspaceRootUri()` did not. Only sub-agent
// worktrees ever call `registerRuntimeRoot`, so nothing registered
// `workspace-1` for the ordinary workspace and every caller of
// `workspaceRootUri` threw before doing any work: structured commands, the
// quality gates, git, the database tool, the container engine, elevation, the
// process supervisor and the intelligence index. The agent could read and
// write files but could not run a single command to verify them.
describe('resolving a command root key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openFolders();
  });

  it('resolves the advertised key the command catalog tells the model to send', () => {
    // structured-command-tool-executor advertises
    // {"cwdRootKey":"workspace-1", ...} as the worked example, so this exact
    // value has to resolve or command execution is unreachable by design.
    const repository = vscode.Uri.file('C:\\workspace');
    openFolders(repository);

    expect(new VscodeFileTransactionAdapter().workspaceRootUri('workspace-1')).toBe(repository);
  });

  it('gives each folder of a multi-root workspace its own tree', () => {
    // A wrong mapping here would run a command against the wrong repository,
    // which is worse than refusing to run it.
    const first = vscode.Uri.file('C:\\first');
    const second = vscode.Uri.file('C:\\second');
    openFolders(first, second);

    const adapter = new VscodeFileTransactionAdapter();

    expect(adapter.workspaceRootUri('workspace-1')).toBe(first);
    expect(adapter.workspaceRootUri('workspace-2')).toBe(second);
  });

  it('keeps a registered runtime root ahead of the advertised index', () => {
    // A sub-agent worktree registers its own root under the key the task runs
    // as. Resolving the advertised index first would silently escape the
    // worktree and mutate the parent checkout.
    const repository = vscode.Uri.file('C:\\workspace');
    openFolders(repository);

    const adapter = new VscodeFileTransactionAdapter();
    adapter.registerRuntimeRoot('workspace-1', 'C:\\worktree');

    expect(adapter.workspaceRootUri('workspace-1').fsPath).toBe('C:\\worktree');
  });

  it('refuses an advertised index past the open folders', () => {
    const repository = vscode.Uri.file('C:\\workspace');
    openFolders(repository);

    expect(() => new VscodeFileTransactionAdapter().workspaceRootUri('workspace-9')).toThrow(
      'Command roots must be workspace folders',
    );
  });

  it('refuses a near miss instead of falling back to the first folder', () => {
    const repository = vscode.Uri.file('C:\\workspace');
    openFolders(repository);

    const adapter = new VscodeFileTransactionAdapter();

    for (const key of ['workspace', 'workspace-', 'workspace-0', 'workspace-01', 'workspace-1x']) {
      expect(() => adapter.workspaceRootUri(key)).toThrow(
        'Command roots must be workspace folders',
      );
    }
  });
});
