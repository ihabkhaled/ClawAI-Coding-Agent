import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceContextService } from '../../src/services/workspace-context-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const vscodeEnvironment = vi.hoisted(() => ({
  activeTextEditor: undefined as
    | {
        document: {
          uri: { path: string };
          getText(): string;
        };
        selection: { isEmpty: boolean };
      }
    | undefined,
  trusted: true,
  workspaceFolders: [{ name: 'claw-workspace', uri: { path: '/workspace' } }],
}));

vi.mock('vscode', () => ({
  FileType: { File: 1 },
  FileSystemError: class FileSystemError extends Error {
    code = 'FileNotFound';
  },
  Uri: {
    joinPath: (base: { path: string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join('/'),
    }),
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
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 10_000,
  maxContextFiles: 10,
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('WorkspaceContextService smart context', () => {
  beforeEach(() => {
    vscodeEnvironment.activeTextEditor = undefined;
    vscodeEnvironment.trusted = true;
    vscodeEnvironment.workspaceFolders = [{ name: 'claw-workspace', uri: { path: '/workspace' } }];
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
});
