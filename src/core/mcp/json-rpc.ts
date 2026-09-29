import { z } from 'zod';

import type { JsonRpcIncoming } from './json-rpc.types';

const jsonRpcIdSchema = z.union([z.number().int(), z.string().max(200)]);

const jsonRpcErrorSchema = z
  .object({ code: z.number().int(), message: z.string().max(4_096), data: z.unknown().optional() })
  .loose();

const responseSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: jsonRpcIdSchema,
    result: z.unknown().optional(),
    error: jsonRpcErrorSchema.optional(),
  })
  .loose();

const requestSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: jsonRpcIdSchema.optional(),
    method: z.string().min(1).max(200),
    params: z.unknown().optional(),
  })
  .loose();

/** A JSON-RPC error a server returned. The message is the server's text, so it is untrusted. */
export class JsonRpcRemoteError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'JsonRpcRemoteError';
  }
}

export function jsonRpcRequest(id: number, method: string, params: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

export function jsonRpcNotification(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
}

export function jsonRpcErrorResponse(id: number | string, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

export function jsonRpcResultResponse(id: number | string, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/**
 * Sorts one decoded message into a response, a server request, a notification
 * or noise. Malformed input is `invalid`, never an exception: a server that
 * prints a stray line must not take the connection down with it.
 */
export function classifyJsonRpc(candidate: unknown): JsonRpcIncoming {
  const request = requestSchema.safeParse(candidate);
  if (request.success) {
    return request.data.id === undefined
      ? { kind: 'notification', method: request.data.method }
      : { kind: 'request', id: request.data.id, method: request.data.method };
  }
  const response = responseSchema.safeParse(candidate);
  if (!response.success) return { kind: 'invalid' };
  if (response.data.error !== undefined) {
    return {
      kind: 'response',
      id: response.data.id,
      error: { code: response.data.error.code, message: response.data.error.message },
    };
  }
  return { kind: 'response', id: response.data.id, result: response.data.result };
}

/** Parses one line or body as JSON, answering `undefined` instead of throwing. */
export function parseJsonSafely(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * The `data:` payloads of a complete `text/event-stream` body, one per event.
 * Multi-line data fields are joined with newlines, as the SSE grammar says.
 */
export function parseServerSentEvents(body: string): string[] {
  const events: string[] = [];
  for (const block of body.split(/\r?\n\r?\n/u)) {
    const data = block
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /u, ''));
    if (data.length > 0) events.push(data.join('\n'));
  }
  return events;
}
