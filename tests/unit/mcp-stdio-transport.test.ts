import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonRpcRemoteError } from '../../src/core/mcp/json-rpc';
import { McpClient } from '../../src/infrastructure/mcp/mcp-client';
import {
  connectMcpServer,
  resolveStdioCwd,
} from '../../src/infrastructure/mcp/mcp-connection-factory';
import { McpStdioTransport } from '../../src/infrastructure/mcp/mcp-stdio-transport';

import type { McpStdioServerConfig } from '../../src/core/mcp/mcp.types';

const fixture = join(__dirname, '..', 'fixtures', 'mcp', 'echo-server.mjs');
const root = join(__dirname, '..', '..');

const server: McpStdioServerConfig = {
  name: 'echo',
  origin: 'workspace',
  transport: 'stdio',
  command: process.execPath,
  args: [fixture],
  env: { CLAW_MCP_TEST: '1' },
};

const open: McpClient[] = [];

afterEach(() => {
  for (const client of open.splice(0)) client.dispose();
});

async function connect(): Promise<McpClient> {
  const client = await connectMcpServer(server, {
    clientVersion: '0.0.0-test',
    workspaceRoot: () => root,
    tokens: () => {
      throw new Error('stdio needs no tokens');
    },
  });
  open.push(client);
  return client;
}

describe('MCP over stdio, end to end against a real child process', () => {
  it('handshakes, pages through tools/list, and calls a tool', async () => {
    const client = await connect();
    const tools = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['echo', 'fail']);
    const result = await client.callTool('echo', { text: 'hi' }, 10_000);
    expect(result.text).toContain('echo: hi');
    expect(result.text).not.toContain('abc123secret');
    expect(result.omittedParts).toEqual(['image (image/png)']);
  });

  it('surfaces a server JSON-RPC error as a remote error', async () => {
    const client = await connect();
    await expect(client.callTool('nope', {}, 10_000)).rejects.toBeInstanceOf(JsonRpcRemoteError);
  });

  it('times out a call the server never answers, and honours abort', async () => {
    const client = await connect();
    await expect(client.callTool('hang', {}, 200)).rejects.toThrow('timed out');
    const controller = new AbortController();
    const pending = client.callTool('hang', {}, 10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
  });

  it('rejects further requests once disposed', async () => {
    const transport = McpStdioTransport.start({
      command: process.execPath,
      args: [fixture],
      env: {},
      cwd: root,
    });
    const client = await McpClient.connect(transport, 'test');
    client.dispose();
    await expect(transport.request('tools/list', {}, 1_000)).rejects.toThrow('closed');
    await expect(transport.notify('x', undefined)).rejects.toThrow('closed');
    client.dispose();
  });

  it('fails the handshake when the command does not exist', async () => {
    const transport = McpStdioTransport.start({
      command: 'clawai-no-such-mcp-command',
      args: [],
      env: {},
      cwd: root,
    });
    await expect(McpClient.connect(transport, 'test')).rejects.toThrow();
  });

  it('fails pending requests with the stderr tail when the server exits', async () => {
    const transport = McpStdioTransport.start({
      command: process.execPath,
      args: [
        '-e',
        'process.stderr.write("dying token=abc"); setTimeout(() => process.exit(3), 50)',
      ],
      env: {},
      cwd: root,
    });
    const error: unknown = await transport
      .request('initialize', {}, 5_000)
      .catch((e: unknown) => e);
    expect(String(error)).toContain('exited with code 3');
    expect(transport.diagnostics()).toContain('token=[REDACTED]');
  });
});

describe('resolveStdioCwd', () => {
  it('keeps workspace servers inside the workspace', () => {
    expect(resolveStdioCwd(server, root)).toBe(root);
    expect(resolveStdioCwd({ ...server, cwd: 'tests' }, root)).toBe(join(root, 'tests'));
    expect(() => resolveStdioCwd({ ...server, cwd: '../..' }, root)).toThrow(
      'leaves the workspace',
    );
    expect(() => resolveStdioCwd({ ...server, cwd: 'x' }, undefined)).toThrow('open workspace');
    expect(resolveStdioCwd({ ...server, origin: 'user', cwd: root }, undefined)).toBe(root);
  });
});
