import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpClient } from '../../src/infrastructure/mcp/mcp-client';
import { connectMcpServer } from '../../src/infrastructure/mcp/mcp-connection-factory';
import {
  McpHttpTransport,
  McpUnauthorizedError,
  responseFor,
} from '../../src/infrastructure/mcp/mcp-http-transport';

import type { McpTokenProvider } from '../../src/infrastructure/mcp/mcp-transport.types';

type Handler = (
  body: { id?: number; method: string },
  request: IncomingMessage,
  response: ServerResponse,
) => void;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    ),
  );
});

async function serve(handler: Handler): Promise<{ url: string; seen: IncomingMessage[] }> {
  const seen: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    seen.push(request);
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      handler(
        raw === ''
          ? { method: request.method ?? '' }
          : (JSON.parse(raw) as { id?: number; method: string }),
        request,
        response,
      );
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      resolve();
    }),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${String(address.port)}/mcp`, seen };
}

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  response.end(JSON.stringify(value));
}

const initialize = { protocolVersion: '2025-06-18', capabilities: {} };

function mcpHandler(authorized: (request: IncomingMessage) => boolean): Handler {
  return (body, request, response) => {
    if (!authorized(request)) {
      response.writeHead(401).end();
      return;
    }
    if (body.method === 'initialize') {
      json(
        response,
        200,
        { jsonrpc: '2.0', id: body.id, result: initialize },
        { 'Mcp-Session-Id': 's-1' },
      );
      return;
    }
    if (body.method === 'notifications/initialized' || body.method === 'DELETE') {
      response.writeHead(202).end();
      return;
    }
    if (body.method === 'tools/list') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(
        `data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'search' }] } })}\n\n`,
      );
      return;
    }
    json(response, 200, {
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: 'found' }] },
    });
  };
}

const anonymous: McpTokenProvider = {
  current: () => Promise.resolve(undefined),
  renew: () => Promise.resolve(undefined),
};

describe('MCP over streamable HTTP, against a real local server', () => {
  it('handshakes, echoes the session id and protocol version, and reads JSON and SSE', async () => {
    const { url, seen } = await serve(mcpHandler(() => true));
    const client = await McpClient.connect(
      new McpHttpTransport({ url, headers: { 'X-Team': 'a' } }, anonymous),
      '1',
    );
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(['search']);
    expect((await client.callTool('search', { q: 'x' }, 5_000)).text).toBe('found');
    const later = seen.at(-1);
    expect(later?.headers['mcp-session-id']).toBe('s-1');
    expect(later?.headers['mcp-protocol-version']).toBe('2025-06-18');
    expect(later?.headers['x-team']).toBe('a');
    client.dispose();
    client.dispose();
  });

  it('renews once after a 401 and sends the new bearer token', async () => {
    const { url, seen } = await serve(
      mcpHandler((request) => request.headers.authorization === 'Bearer fresh'),
    );
    const tokens: McpTokenProvider = {
      current: vi.fn(() => Promise.resolve('stale')),
      renew: vi.fn(() => Promise.resolve('fresh')),
    };
    const client = await connectMcpServer(
      {
        name: 'r',
        origin: 'user',
        transport: 'http',
        url,
        headers: {},
        oauth: { clientId: 'c', scopes: [] },
      },
      { clientVersion: '1', workspaceRoot: () => undefined, tokens: () => tokens },
    );
    expect(tokens.renew).toHaveBeenCalledTimes(2);
    expect(seen.some((request) => request.headers.authorization === 'Bearer fresh')).toBe(true);
    client.dispose();
  });

  it('gives up with McpUnauthorizedError when no token can be obtained, or the second try is refused', async () => {
    const { url } = await serve(mcpHandler(() => false));
    await expect(
      McpClient.connect(new McpHttpTransport({ url, headers: {} }, anonymous), '1'),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
    const always: McpTokenProvider = {
      current: () => Promise.resolve('a'),
      renew: () => Promise.resolve('b'),
    };
    await expect(
      McpClient.connect(new McpHttpTransport({ url, headers: {} }, always), '1'),
    ).rejects.toBeInstanceOf(McpUnauthorizedError);
  });

  it('reports a non-OK status and refuses use after dispose', async () => {
    const { url } = await serve((_body, _request, response) => {
      response.writeHead(500).end('boom');
    });
    const transport = new McpHttpTransport({ url, headers: {} }, anonymous);
    await expect(transport.request('tools/list', {}, 5_000)).rejects.toThrow('HTTP 500');
    transport.dispose();
    await expect(transport.request('tools/list', {}, 5_000)).rejects.toThrow('closed');
  });

  it('picks the matching response out of a body and surfaces remote errors', () => {
    expect(
      responseFor(
        2,
        JSON.stringify([
          { jsonrpc: '2.0', id: 1, result: 1 },
          { jsonrpc: '2.0', id: 2, result: 'two' },
        ]),
        'application/json',
      ),
    ).toBe('two');
    expect(() =>
      responseFor(
        3,
        JSON.stringify({ jsonrpc: '2.0', id: 3, error: { code: -1, message: 'bad' } }),
        '',
      ),
    ).toThrow('bad');
    expect(() => responseFor(4, 'not json', '')).toThrow('did not answer');
  });
});
