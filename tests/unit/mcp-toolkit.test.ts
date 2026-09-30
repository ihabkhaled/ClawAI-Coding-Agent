import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mcpToolkit } from '../../src/sdk/mcp-toolkit';

import type { AgentToolkit } from '../../src/sdk/agent-sdk.types';

const fixture = join(__dirname, '..', 'fixtures', 'mcp', 'echo-server.mjs');
const root = join(__dirname, '..', '..');
const config = { mcpServers: { echo: { command: process.execPath, args: [fixture] } } };

const open: AgentToolkit[] = [];

afterEach(() => {
  for (const toolkit of open.splice(0)) toolkit.dispose?.();
});

function toolkit(
  policy?: unknown,
  allow: readonly ('read' | 'mcp')[] = ['read', 'mcp'],
  approve?: (call: { operation: string }) => boolean,
): AgentToolkit {
  const built = mcpToolkit({ config, ...(policy === undefined ? {} : { policy }) }, root, {
    allow,
    approve,
  });
  open.push(built);
  return built;
}

function call(operation: string, args: Record<string, unknown> = {}) {
  return { toolName: 'runtime.mcp', operation, arguments: args };
}

describe('mcpToolkit', () => {
  it('offers runtime.mcp only when the mcp category is granted', () => {
    expect(toolkit().definitions).toHaveLength(1);
    expect(toolkit(undefined, ['read']).definitions).toHaveLength(0);
  });

  it('lists servers, lists tools, and calls one through the real client', async () => {
    const kit = toolkit();

    const servers = (await kit.execute(call('servers'))) as { servers: { name: string }[] };
    const tools = (await kit.execute(call('tools', { server: 'echo' }))) as {
      tools: { name: string }[];
      untrusted: boolean;
    };
    const result = (await kit.execute(
      call('call', { server: 'echo', tool: 'echo', arguments: { text: 'hi' } }),
    )) as { text: string; isError: boolean; untrusted: boolean };

    expect(servers.servers.map((entry) => entry.name)).toEqual(['echo']);
    expect(tools.tools.map((entry) => entry.name)).toEqual(['echo', 'fail']);
    expect(tools.untrusted).toBe(true);
    expect(result.text).toContain('echo: hi');
    expect(result.isError).toBe(false);
  }, 20_000);

  it('applies the server policy: deny wins, and a refused server never starts', async () => {
    const kit = toolkit({ deny: [{ name: 'echo', reason: 'no' }] });

    const servers = (await kit.execute(call('servers'))) as {
      servers: unknown[];
      refused: { code: string }[];
    };

    expect(servers.servers).toEqual([]);
    expect(servers.refused[0]?.code).toBe('MCP_SERVER_DENIED');
    await expect(kit.execute(call('tools', { server: 'echo' }))).rejects.toThrow(/refused/u);
  });

  it('treats a malformed policy as deny-everything, and an allowlist as exclusive', async () => {
    const malformed = toolkit({ allow: 'nope' });
    const other = toolkit({ allow: [{ name: 'someone-else' }] });

    const first = (await malformed.execute(call('servers'))) as { refused: unknown[] };
    const second = (await other.execute(call('servers'))) as { refused: { code: string }[] };

    expect(first.refused).toHaveLength(1);
    expect(second.refused[0]?.code).toBe('MCP_SERVER_NOT_ALLOWED');
  });

  it('asks the approval callback per call, and refuses when it says no', async () => {
    const asked: string[] = [];
    const kit = toolkit(undefined, ['mcp'], (request) => {
      asked.push(request.operation);
      return request.operation !== 'call';
    });

    expect(await kit.authorize?.(call('servers'))).toBe(true);
    expect(await kit.authorize?.(call('call', { server: 'echo', tool: 'echo' }))).toBe(false);
    expect(asked).toEqual(['servers', 'call']);
  });

  it('refuses a tool it was not offered', async () => {
    expect(await toolkit(undefined, ['read']).authorize?.(call('servers'))).toBe(false);
    expect(await toolkit().authorize?.({ ...call('servers'), toolName: 'workspace.file' })).toBe(
      false,
    );
  });

  it('refuses a server that needs an interactive OAuth sign-in', async () => {
    const kit = mcpToolkit(
      {
        config: {
          mcpServers: {
            remote: { url: 'https://example.com/mcp', oauth: { clientId: 'client' } },
          },
        },
      },
      root,
      { allow: ['mcp'] },
    );
    open.push(kit);

    await expect(kit.execute(call('tools', { server: 'remote' }))).rejects.toThrow(/OAuth/u);
  });
});
