import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_MCP_CONFIG_BYTES } from '../../src/core/mcp/mcp.constants';

const captured = vi.hoisted(() => ({
  deps: undefined as
    | undefined
    | {
        workspaceConfig: () => Promise<unknown>;
        workspaceTrusted: () => boolean;
        organizationPolicy: () => unknown;
      },
  dispose: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('vscode', () => {
  class FileSystemError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    workspace: { isTrusted: false, fs: { readFile: captured.readFile } },
    FileSystemError,
    Uri: { joinPath: () => ({ fsPath: '/x' }), parse: () => ({}) },
    env: { openExternal: vi.fn() },
    l10n: { t: (message: string) => message },
  };
});
vi.mock('../../src/services/mcp-server-registry', () => ({
  McpServerRegistry: vi.fn(function capture(deps: never) {
    captured.deps = deps;
    return { dispose: captured.dispose };
  }),
}));
vi.mock('../../src/services/mcp-oauth-service', () => ({ McpOAuthService: vi.fn() }));
vi.mock('../../src/services/project-policy-service', () => ({ ProjectPolicyService: vi.fn() }));
vi.mock('../../src/infrastructure/mcp-tool-executor', () => ({
  McpToolExecutor: vi.fn(),
  mcpToolDefinition: { name: 'runtime.mcp' },
}));
vi.mock('../../src/services/workspace-plugins', () => ({
  workspacePluginStore: () => ({}),
  pluginMcpConfig: async () => ({ servers: [], errors: [] }),
}));

const vscode = await import('vscode');
const { mcpToolRegistration } = await import('../../src/services/mcp-registration');

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function register(hasFolder = true) {
  const subscriptions: { dispose(): void }[] = [];
  mcpToolRegistration(
    { subscriptions, secrets: {}, globalStorageUri: { fsPath: '/g' } } as never,
    {
      selectedFolder: () => {
        if (!hasFolder) throw new Error('no folder');
        return { uri: { fsPath: '/repo' } };
      },
    } as never,
    { snapshot: { organizationPolicy: { mcpServers: { allow: ['a'] } } } } as never,
    { mcpServers: () => undefined } as never,
  );
  return subscriptions;
}

beforeEach(() => {
  captured.readFile.mockReset();
  captured.dispose.mockReset();
});

describe('mcpToolRegistration workspace config', () => {
  it('reads nothing when no folder is open', async () => {
    register(false);
    await expect(captured.deps?.workspaceConfig()).resolves.toBeUndefined();
    expect(captured.readFile).not.toHaveBeenCalled();
  });

  it('parses a valid .clawai/mcp.json', async () => {
    register();
    captured.readFile.mockResolvedValue(bytes('{"servers":{"a":{}}}'));
    await expect(captured.deps?.workspaceConfig()).resolves.toEqual({ servers: { a: {} } });
  });

  it('treats a missing file as no config, but any other read error as a failure', async () => {
    register();
    captured.readFile.mockRejectedValueOnce(new vscode.FileSystemError('FileNotFound'));
    await expect(captured.deps?.workspaceConfig()).resolves.toBeUndefined();
    captured.readFile.mockRejectedValueOnce(new vscode.FileSystemError('NoPermissions'));
    await expect(captured.deps?.workspaceConfig()).rejects.toThrow('NoPermissions');
  });

  it('refuses an oversize file without parsing it', async () => {
    register();
    captured.readFile.mockResolvedValue(new Uint8Array(MAX_MCP_CONFIG_BYTES + 1));
    await expect(captured.deps?.workspaceConfig()).rejects.toThrow('.clawai/mcp.json is too large');
  });

  it('rejects malformed JSON and invalid UTF-8 rather than guessing', async () => {
    register();
    captured.readFile.mockResolvedValueOnce(bytes('{nope'));
    await expect(captured.deps?.workspaceConfig()).rejects.toThrow();
    captured.readFile.mockResolvedValueOnce(new Uint8Array([0xff, 0xfe, 0x7b]));
    await expect(captured.deps?.workspaceConfig()).rejects.toThrow();
  });

  it('passes trust and the organization policy through, and closes servers on dispose', () => {
    const subscriptions = register();
    expect(captured.deps?.workspaceTrusted()).toBe(false);
    expect(captured.deps?.organizationPolicy()).toEqual({ allow: ['a'] });
    expect(subscriptions).toHaveLength(1);
    subscriptions[0]?.dispose();
    expect(captured.dispose).toHaveBeenCalledOnce();
  });
});
