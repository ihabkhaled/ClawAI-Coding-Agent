import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcRemoteError } from '../../src/core/mcp/json-rpc';
import { McpPendingRequests } from '../../src/infrastructure/mcp/mcp-pending-requests';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('McpPendingRequests', () => {
  it('allocates increasing ids', () => {
    const pending = new McpPendingRequests();
    expect([pending.allocate(), pending.allocate(), pending.allocate()]).toEqual([1, 2, 3]);
  });

  it('resolves with the result and forgets the entry', async () => {
    const pending = new McpPendingRequests();
    const id = pending.allocate();
    const answer = pending.wait(id, 'tools/list', 1000);
    expect(pending.size).toBe(1);
    pending.resolve(id, { ok: 1 });
    await expect(answer).resolves.toEqual({ ok: 1 });
    expect(pending.size).toBe(0);
  });

  it('rejects with the remote error code and message', async () => {
    const pending = new McpPendingRequests();
    const id = pending.allocate();
    const answer = pending.wait(id, 'x', 1000);
    pending.resolve(id, undefined, { code: -32601, message: 'no such method' });
    const error = await answer.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JsonRpcRemoteError);
    expect((error as Error).message).toContain('no such method');
  });

  it('times out with the method name and leaves nothing behind', async () => {
    const pending = new McpPendingRequests();
    const answer = pending.wait(pending.allocate(), 'tools/call', 500);
    const assertion = expect(answer).rejects.toThrow('MCP request tools/call timed out');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(pending.size).toBe(0);
  });

  it('is cancelled by an abort signal, and by one already aborted', async () => {
    const pending = new McpPendingRequests();
    const controller = new AbortController();
    const answer = pending.wait(pending.allocate(), 'a', 1000, controller.signal);
    controller.abort();
    await expect(answer).rejects.toThrow('MCP request a was cancelled');
    expect(pending.size).toBe(0);

    const late = pending.wait(pending.allocate(), 'b', 1000, AbortSignal.abort());
    await expect(late).rejects.toThrow('MCP request b was cancelled');
    expect(pending.size).toBe(0);
  });

  it('ignores a response for an id nobody is waiting for, or a second response', async () => {
    const pending = new McpPendingRequests();
    const id = pending.allocate();
    const answer = pending.wait(id, 'x', 1000);
    pending.resolve(999, 'stray');
    pending.resolve(id, 'first');
    pending.resolve(id, 'second');
    await expect(answer).resolves.toBe('first');
  });

  it('does not fire the timeout after the response arrived', async () => {
    const pending = new McpPendingRequests();
    const id = pending.allocate();
    const answer = pending.wait(id, 'x', 500);
    pending.resolve(id, 'done');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(answer).resolves.toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails every outstanding request when the connection drops', async () => {
    const pending = new McpPendingRequests();
    const first = pending.wait(pending.allocate(), 'a', 1000);
    const second = pending.wait(pending.allocate(), 'b', 1000);
    pending.failAll(new Error('connection closed'));
    await expect(first).rejects.toThrow('connection closed');
    await expect(second).rejects.toThrow('connection closed');
    expect(pending.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
