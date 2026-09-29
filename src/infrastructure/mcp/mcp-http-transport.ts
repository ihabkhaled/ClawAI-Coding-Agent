import {
  classifyJsonRpc,
  JsonRpcRemoteError,
  jsonRpcNotification,
  jsonRpcRequest,
  parseJsonSafely,
  parseServerSentEvents,
} from '../../core/mcp/json-rpc';
import { MCP_MAX_MESSAGE_BYTES } from '../../core/mcp/mcp.constants';

import type { McpFetch, McpHttpEndpoint, McpTokenProvider } from './mcp-transport.types';
import type { McpTransport } from '../../core/mcp/mcp.types';

export class McpUnauthorizedError extends Error {
  constructor() {
    super('MCP server requires authorization, and none could be obtained');
    this.name = 'McpUnauthorizedError';
  }
}

async function readBounded(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MCP_MAX_MESSAGE_BYTES) {
      await reader.cancel();
      throw new Error('MCP server sent a response larger than the bound');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function candidateMessages(body: string, contentType: string): unknown[] {
  const payloads = contentType.includes('text/event-stream') ? parseServerSentEvents(body) : [body];
  return payloads.flatMap((payload) => {
    const parsed = parseJsonSafely(payload);
    return Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  });
}

/** Picks the response to `id` out of a JSON or SSE body, ignoring everything else in it. */
export function responseFor(id: number, body: string, contentType: string): unknown {
  for (const message of candidateMessages(body, contentType)) {
    const incoming = classifyJsonRpc(message);
    if (incoming.kind !== 'response' || incoming.id !== id) continue;
    if (incoming.error !== undefined) {
      throw new JsonRpcRemoteError(incoming.error.code, incoming.error.message);
    }
    return incoming.result;
  }
  throw new Error('MCP server did not answer the request');
}

/**
 * MCP streamable HTTP: every client message is one POST; the answer comes back
 * as JSON or as a short event stream. The session id the server assigns on
 * `initialize` is echoed on every later request.
 *
 * A 401 is answered once, by asking the token provider to renew. A second 401
 * is final, so a misconfigured server cannot put the user in an authorization
 * loop.
 */
export class McpHttpTransport implements McpTransport {
  private nextId = 1;
  private sessionId: string | undefined;
  private protocolVersion: string | undefined;
  private closed = false;

  constructor(
    private readonly endpoint: McpHttpEndpoint,
    private readonly tokens: McpTokenProvider,
    private readonly fetchImpl: McpFetch = (input, init) => fetch(input, init),
  ) {}

  /** Sent as `MCP-Protocol-Version` once the handshake settled on one. */
  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    const response = await this.post(jsonRpcRequest(id, method, params), timeoutMs, signal);
    const body = await readBounded(response);
    return responseFor(id, body, response.headers.get('content-type') ?? '');
  }

  async notify(method: string, params: unknown): Promise<void> {
    const response = await this.post(jsonRpcNotification(method, params), 30_000);
    await response.body?.cancel();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.sessionId === undefined) return;
    // Best effort: a server that does not support session deletion answers 405.
    void this.fetchImpl(this.endpoint.url, {
      method: 'DELETE',
      headers: this.headers(undefined),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }

  private async post(body: string, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    if (this.closed) throw new Error('MCP server connection is closed');
    let response = await this.send(body, await this.tokens.current(signal), timeoutMs, signal);
    if (response.status === 401) {
      await response.body?.cancel();
      const renewed = await this.tokens.renew(signal);
      if (renewed === undefined) throw new McpUnauthorizedError();
      response = await this.send(body, renewed, timeoutMs, signal);
      if (response.status === 401) throw new McpUnauthorizedError();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MCP server answered HTTP ${String(response.status)}`);
    }
    this.sessionId = response.headers.get('mcp-session-id') ?? this.sessionId;
    return response;
  }

  private send(
    body: string,
    token: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const deadline = AbortSignal.timeout(timeoutMs);
    return this.fetchImpl(this.endpoint.url, {
      method: 'POST',
      headers: {
        ...this.headers(token),
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
      redirect: 'error',
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    });
  }

  private headers(token: string | undefined): Record<string, string> {
    return {
      ...this.endpoint.headers,
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      ...(this.sessionId === undefined ? {} : { 'Mcp-Session-Id': this.sessionId }),
      ...(this.protocolVersion === undefined
        ? {}
        : { 'MCP-Protocol-Version': this.protocolVersion }),
    };
  }
}
