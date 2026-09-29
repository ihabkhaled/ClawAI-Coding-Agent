import { JsonRpcRemoteError } from '../../core/mcp/json-rpc';

import type { JsonRpcErrorBody, JsonRpcId } from '../../core/mcp/json-rpc.types';

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

/**
 * Outstanding requests on one connection, each with its own deadline.
 *
 * Every entry is settled exactly once: by its response, by its timeout, by
 * its abort signal, or by the connection failing. Nothing is left waiting on a
 * server that has gone away.
 */
export class McpPendingRequests {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextId = 1;

  allocate(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  wait(id: number, method: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id)?.reject(new Error(`MCP request ${method} timed out`));
      }, timeoutMs);
      timer.unref();
      const aborted = (): void => {
        this.settle(id)?.reject(new Error(`MCP request ${method} was cancelled`));
      };
      signal?.addEventListener('abort', aborted, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', aborted);
        },
      });
      if (signal?.aborted === true) aborted();
    });
  }

  resolve(id: JsonRpcId, result: unknown, error?: JsonRpcErrorBody): void {
    const entry = this.settle(id);
    if (entry === undefined) return;
    if (error === undefined) entry.resolve(result);
    else entry.reject(new JsonRpcRemoteError(error.code, error.message));
  }

  failAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.settle(id)?.reject(error);
  }

  get size(): number {
    return this.pending.size;
  }

  private settle(id: JsonRpcId): PendingRequest | undefined {
    const entry = this.pending.get(id);
    if (entry === undefined) return undefined;
    this.pending.delete(id);
    entry.cleanup();
    return entry;
  }
}
