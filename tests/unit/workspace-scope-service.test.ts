import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const vscodeEnvironment = vi.hoisted(() => {
  const uri = (value: string) => ({
    fsPath: new URL(value).pathname,
    path: new URL(value).pathname,
    toString: () => value,
  });
  const api = { name: 'api', uri: uri('file:///workspace/api') };
  const web = { name: 'web', uri: uri('file:///workspace/web') };
  return {
    activeTextEditor: undefined as { document: { uri: ReturnType<typeof uri> } } | undefined,
    api,
    folders: [api, web],
    uri,
    web,
  };
});

vi.mock('vscode', () => ({
  Uri: {
    parse: (value: string) => vscodeEnvironment.uri(value),
  },
  l10n: {
    t: (message: string) => message,
  },
  window: {
    get activeTextEditor() {
      return vscodeEnvironment.activeTextEditor;
    },
  },
  workspace: {
    getWorkspaceFolder: (uri: { path: string }) =>
      vscodeEnvironment.folders.find((folder) => uri.path.startsWith(`${folder.uri.path}/`)),
    get workspaceFolders() {
      return vscodeEnvironment.folders;
    },
  },
}));

import { workspaceFolderKey } from '../../src/core/workspace-scope';
import { WorkspaceScopeService } from '../../src/services/workspace-scope-service';

describe('WorkspaceScopeService', () => {
  beforeEach(() => {
    vscodeEnvironment.activeTextEditor = {
      document: { uri: vscodeEnvironment.uri('file:///workspace/web/src/app.ts') },
    };
    vscodeEnvironment.folders = [vscodeEnvironment.api, vscodeEnvironment.web];
  });

  it('freezes the active root when a run first consumes the selected folder', () => {
    const service = new WorkspaceScopeService();

    expect(service.selectedFolder()).toBe(vscodeEnvironment.web);
    vscodeEnvironment.activeTextEditor = {
      document: { uri: vscodeEnvironment.uri('file:///workspace/api/src/other.ts') },
    };

    expect(service.selectedFolder()).toBe(vscodeEnvironment.web);
    service.select(workspaceFolderKey(vscodeEnvironment.api.uri.toString()));
    vscodeEnvironment.activeTextEditor = {
      document: { uri: vscodeEnvironment.uri('file:///workspace/web/src/other.ts') },
    };

    expect(service.selectedFolder()).toBe(vscodeEnvironment.api);
    expect(service.snapshot().selectedFolderName).toBe('api');
  });

  it('rejects stale scope keys and files outside the selected root', () => {
    const service = new WorkspaceScopeService();
    service.select(workspaceFolderKey(vscodeEnvironment.api.uri.toString()));

    expect(service.relativePath(vscode.Uri.parse('file:///workspace/api/src/app.ts'))).toBe(
      'src/app.ts',
    );
    expect(() =>
      service.relativePath(vscode.Uri.parse('file:///workspace/web/src/app.ts')),
    ).toThrow('outside the selected workspace folder');
    expect(() => service.select('stale-key')).toThrow('no longer available');
  });

  it('falls back safely when an explicitly selected folder is removed', () => {
    const service = new WorkspaceScopeService();
    service.select(workspaceFolderKey(vscodeEnvironment.api.uri.toString()));
    vscodeEnvironment.folders = [vscodeEnvironment.web];

    expect(service.refresh().selectedFolderName).toBe('web');
    expect(service.selectedFolder()).toBe(vscodeEnvironment.web);
  });
});
