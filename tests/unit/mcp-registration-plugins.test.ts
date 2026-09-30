import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  deps: undefined as undefined | { pluginConfig?: () => Promise<unknown> },
  folder: undefined as undefined | (() => unknown),
}));

vi.mock('vscode', () => ({
  workspace: { isTrusted: true, fs: {} },
  FileSystemError: class extends Error {},
  Uri: { joinPath: () => ({ fsPath: '/x' }), parse: () => ({}) },
  env: { openExternal: vi.fn() },
  l10n: { t: (message: string) => message },
}));
vi.mock('../../src/services/mcp-server-registry', () => ({
  McpServerRegistry: vi.fn(function capture(deps: { pluginConfig?: () => Promise<unknown> }) {
    captured.deps = deps;
    return { dispose: vi.fn() };
  }),
}));
vi.mock('../../src/services/mcp-oauth-service', () => ({ McpOAuthService: vi.fn() }));
vi.mock('../../src/services/project-policy-service', () => ({ ProjectPolicyService: vi.fn() }));
vi.mock('../../src/infrastructure/mcp-tool-executor', () => ({
  McpToolExecutor: vi.fn(),
  mcpToolDefinition: { name: 'runtime.mcp' },
}));
vi.mock('../../src/services/workspace-plugins', () => ({
  workspacePluginStore: (_global: unknown, folder: () => unknown) => {
    captured.folder = folder;
    return { store: true };
  },
  pluginMcpConfig: async (store: unknown) => ({ servers: [], errors: [JSON.stringify(store)] }),
}));

const { mcpToolRegistration } = await import('../../src/services/mcp-registration');

describe('mcpToolRegistration', () => {
  it('feeds enabled plugins’ MCP servers to the registry', async () => {
    let open = true;
    mcpToolRegistration(
      { subscriptions: [], secrets: {}, globalStorageUri: { fsPath: '/g' } } as never,
      {
        selectedFolder: () => {
          if (!open) throw new Error('no folder');
          return { uri: { fsPath: '/repo' } };
        },
      } as never,
      { snapshot: {} } as never,
      { mcpServers: () => undefined } as never,
    );

    await expect(captured.deps?.pluginConfig?.()).resolves.toEqual({
      servers: [],
      errors: ['{"store":true}'],
    });
    expect(captured.folder?.()).toEqual({ fsPath: '/repo' });
    open = false;
    expect(captured.folder?.()).toBeUndefined();
  });
});
