import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { workspaceFolderKey } from '../../src/core/workspace-scope';
import { WorkspaceContextService } from '../../src/services/workspace-context-service';
import { WorkspaceScopeService } from '../../src/services/workspace-scope-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const vscodeEnvironment = vi.hoisted(() => ({
  activeTextEditor: undefined as
    | {
        document: {
          uri: { path: string; toString(): string };
          getText(): string;
        };
        selection: { isEmpty: boolean };
      }
    | undefined,
  trusted: true,
  workspaceFolders: [] as {
    name: string;
    uri: { path: string; toString(): string };
  }[],
}));

vi.mock('vscode', () => ({
  FileType: { File: 1 },
  FileSystemError: class FileSystemError extends Error {
    code = 'FileNotFound';
  },
  Uri: {
    joinPath: (base: { path: string; toString(): string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join('/'),
      toString: () => `${base.toString()}/${parts.join('/')}`,
    }),
  },
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: { name: string },
      readonly pattern: string,
    ) {}
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
    asRelativePath: (uri: { path: string }) => uri.path.replace('/workspace/', ''),
    findFiles: vi.fn(async () => []),
    getWorkspaceFolder: (uri: { path: string }) =>
      vscodeEnvironment.workspaceFolders.find((folder) =>
        uri.path.startsWith(`${folder.uri.path}/`),
      ),
    fs: {
      readFile: vi.fn(async () => new Uint8Array()),
      stat: vi.fn(),
    },
    get isTrusted() {
      return vscodeEnvironment.trusted;
    },
    get workspaceFolders() {
      return vscodeEnvironment.workspaceFolders;
    },
  },
}));

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 10_000,
  maxContextFiles: 10,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('WorkspaceContextService smart context', () => {
  beforeEach(() => {
    vscodeEnvironment.activeTextEditor = undefined;
    vscodeEnvironment.trusted = true;
    vscodeEnvironment.workspaceFolders = [
      {
        name: 'claw-workspace',
        uri: {
          path: '/workspace',
          toString: () => 'file:///workspace',
        },
      },
    ];
    vi.clearAllMocks();
  });

  it('collects the trusted workspace when no editor is active', async () => {
    const service = new WorkspaceContextService();

    await expect(service.smart(configuration)).resolves.toMatchObject({
      files: [],
      receipt: {
        included: [],
        totalBytes: 0,
      },
    });
    expect(service.readiness()).toEqual({
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: true,
      workspaceName: 'claw-workspace',
    });
  });

  it('uses empty context instead of throwing when no workspace or editor exists', async () => {
    vscodeEnvironment.workspaceFolders = [];
    const service = new WorkspaceContextService();

    await expect(service.smart(configuration)).resolves.toMatchObject({
      files: [],
      receipt: {
        included: [],
      },
    });
  });

  it('collects files and project rules only from the explicitly selected multi-root folder', async () => {
    const api = {
      name: 'api',
      uri: { path: '/workspace/api', toString: () => 'file:///workspace/api' },
    };
    const web = {
      name: 'web',
      uri: { path: '/workspace/web', toString: () => 'file:///workspace/web' },
    };
    vscodeEnvironment.workspaceFolders = [api, web];
    const scope = new WorkspaceScopeService();
    scope.select(workspaceFolderKey(web.uri.toString()));
    const service = new WorkspaceContextService(undefined, scope);

    await service.workspace(configuration);
    await service.projectRules();

    expect(vi.mocked(vscode.workspace.findFiles)).toHaveBeenCalledWith(
      expect.objectContaining({ base: web, pattern: '**/*' }),
      undefined,
      100,
    );
    expect(vi.mocked(vscode.workspace.fs.readFile)).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/web/.clawai/rules.md' }),
    );
  });
});
