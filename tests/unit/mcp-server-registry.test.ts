import { describe, expect, it, vi } from 'vitest';

import { McpToolExecutor, mcpToolDefinition } from '../../src/infrastructure/mcp-tool-executor';
import { McpServerRegistry } from '../../src/services/mcp-server-registry';

import type { McpSession } from '../../src/core/mcp/mcp.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { McpRegistryDependencies } from '../../src/services/mcp-server-registry.types';

function fakeClient(): McpSession {
  return {
    listTools: vi.fn(() => Promise.resolve([{ name: 't', description: 'd', inputSchema: '{}' }])),
    callTool: vi.fn(() =>
      Promise.resolve({ text: 'ok', truncated: false, isError: false, omittedParts: [] }),
    ),
    dispose: vi.fn(),
  };
}

function registry(overrides: Partial<McpRegistryDependencies> = {}) {
  const clients: McpSession[] = [];
  const deps: McpRegistryDependencies = {
    userConfig: () => ({
      servers: { remote: { url: 'https://r.test/mcp', oauth: { clientId: 'c' } } },
    }),
    workspaceConfig: () =>
      Promise.resolve({ servers: { local: { command: 'node', args: ['s.js'] } } }),
    projectPolicy: () => Promise.resolve(undefined),
    organizationPolicy: () => undefined,
    workspaceTrusted: () => true,
    connect: vi.fn(() => {
      const client = fakeClient();
      clients.push(client);
      return Promise.resolve(client);
    }),
    ...overrides,
  };
  return { registry: new McpServerRegistry(deps), deps, clients };
}

describe('McpServerRegistry', () => {
  it('lists user and workspace servers with their policy verdicts', async () => {
    const { registry: subject } = registry({
      organizationPolicy: () => ({ deny: [{ command: 'node *', reason: 'no local node' }] }),
    });
    const report = await subject.servers();
    expect(report.servers).toEqual([
      {
        name: 'remote',
        origin: 'user',
        transport: 'http',
        target: 'https://r.test/mcp',
        connected: false,
        oauth: true,
      },
    ]);
    expect(report.refused).toEqual([
      { name: 'local', code: 'MCP_SERVER_DENIED', source: 'organization', reason: 'no local node' },
    ]);
  });

  it('never starts a refused server, and names an unknown one', async () => {
    const { registry: subject, deps } = registry({
      projectPolicy: () => Promise.resolve({ allow: [{ name: 'remote' }] }),
    });
    await expect(subject.tools('local')).rejects.toThrow('MCP_SERVER_NOT_ALLOWED');
    await expect(subject.tools('ghost')).rejects.toThrow('No MCP server named "ghost"');
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it('reuses a connection, and closes it once policy starts refusing the server', async () => {
    let denied = false;
    const {
      registry: subject,
      deps,
      clients,
    } = registry({
      organizationPolicy: () => (denied ? { deny: [{ name: 'local' }] } : undefined),
    });
    await subject.tools('local');
    await subject.call('local', 't', {}, 1_000);
    expect(deps.connect).toHaveBeenCalledTimes(1);
    expect((await subject.servers()).servers.find((s) => s.name === 'local')?.connected).toBe(true);
    denied = true;
    await expect(subject.call('local', 't', {}, 1_000)).rejects.toThrow('refused');
    await vi.waitFor(() => {
      expect(clients[0]?.dispose).toHaveBeenCalled();
    });
  });

  it('forgets a failed connection so the next call retries, and disposes everything', async () => {
    const connect = vi
      .fn<McpRegistryDependencies['connect']>()
      .mockRejectedValueOnce(new Error('spawn failed'))
      .mockResolvedValue(fakeClient());
    const { registry: subject } = registry({ connect });
    await expect(subject.tools('local')).rejects.toThrow('spawn failed');
    await subject.tools('local');
    expect(connect).toHaveBeenCalledTimes(2);
    subject.dispose();
    expect((await subject.servers()).servers.every((s) => !s.connected)).toBe(true);
  });

  it('reports an unreadable workspace file and refuses stdio in an untrusted workspace', async () => {
    const { registry: subject } = registry({
      workspaceConfig: () => Promise.reject(new Error('Unexpected token')),
      workspaceTrusted: () => false,
    });
    const report = await subject.servers();
    expect(report.errors[0]).toContain('could not be read: Unexpected token');
    const untrusted = registry({ workspaceTrusted: () => false });
    expect((await untrusted.registry.servers()).refused[0]?.code).toBe('MCP_WORKSPACE_UNTRUSTED');
  });
});

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:mcp',
    runId: 'runtime:mcp',
    turnId: 'turn:mcp',
    toolName: 'runtime.mcp',
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:mcp',
    requestedAt: '2026-09-29T12:00:00.000Z',
  } as ToolInvocation;
}

describe('McpToolExecutor', () => {
  it('exposes servers, tools and call through one runtime tool', async () => {
    const { registry: subject } = registry();
    const executor = new McpToolExecutor(subject);
    expect(mcpToolDefinition.operations).toEqual(['servers', 'tools', 'call']);
    const servers = await executor.execute(invocation('servers', {}));
    expect(servers.structured?.servers).toHaveLength(2);
    const tools = await executor.execute(invocation('tools', { server: 'local' }));
    expect(tools.structured).toMatchObject({ server: 'local', untrusted: true });
    const call = await executor.execute(
      invocation('call', { server: 'local', tool: 't', arguments: { q: 1 }, timeoutMs: 5_000 }),
    );
    expect(call.structured).toMatchObject({
      tool: 't',
      text: 'ok',
      isError: false,
      untrusted: true,
    });
  });

  it('rejects unknown operations, foreign tools and malformed arguments', async () => {
    const executor = new McpToolExecutor(registry().registry);
    await expect(executor.execute(invocation('delete', {}))).rejects.toThrow(
      'Unknown MCP operation',
    );
    await expect(
      executor.execute({ ...invocation('servers', {}), toolName: 'workspace.web' }),
    ).rejects.toThrow('Unknown MCP tool');
    await expect(
      executor.execute(invocation('call', { server: '../x', tool: 't' })),
    ).rejects.toThrow();
    await expect(
      executor.execute(invocation('call', { server: 'local', tool: 't', timeoutMs: 1 })),
    ).rejects.toThrow();
  });
});
