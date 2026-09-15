import { describe, expect, it, vi } from 'vitest';

import { canonicalJson, sha256 } from '../../src/headless/headless-transport';
import { runAgent } from '../../src/sdk/agent-sdk';
import { toolResultFor } from '../../src/sdk/agent-tool-result';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentToolkit, RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';

function toolRequest(toolName: string, operation: string, args: unknown): HeadlessStreamEvent {
  return {
    type: 'tool.requested',
    payload: {
      invocationId: 'invocation-1',
      toolName,
      operation,
      invocation: { arguments: args },
    },
  };
}

function transport(
  events: readonly HeadlessStreamEvent[],
  submitted: unknown[] = [],
): RuntimeTransportPort {
  return {
    signIn: async () => Promise.resolve('token'),
    createThread: async () => Promise.resolve('thread-1'),
    startRun: async () => Promise.resolve({ runId: 'run-1', generation: 'gen-1' }),
    submitResult: async (_token, _run, _epochs, result) => {
      submitted.push(result);
      return Promise.resolve({});
    },
    events: async function* stream() {
      for (const event of events) yield await Promise.resolve(event);
    },
  };
}

const echo: AgentToolkit = {
  definitions: [{ name: 'demo.tool' }],
  execute: (call) => ({ saw: call.operation, args: call.arguments }),
};

describe('runAgent', () => {
  it('runs a task to completion against a substituted transport', async () => {
    const result = await runAgent({
      prompt: 'do the thing',
      toolkit: echo,
      credentials: { email: 'a@b.c', password: 'x' },
      transport: transport([{ type: 'run.completed' }]),
    });

    expect(result.outcome).toBe('completed');
    expect(result.runId).toBe('run-1');
  });

  it('calls the caller-supplied toolkit rather than any tools of its own', async () => {
    const execute = vi.fn(() => ({ ok: true }));

    await runAgent({
      prompt: 'p',
      toolkit: { definitions: [], execute },
      credentials: { email: 'a@b.c', password: 'x' },
      transport: transport([
        toolRequest('demo.tool', 'read', { path: 'a.txt' }),
        { type: 'run.completed' },
      ]),
    });

    expect(execute).toHaveBeenCalledWith({
      toolName: 'demo.tool',
      operation: 'read',
      arguments: { path: 'a.txt' },
    });
  });

  it('sends the caller catalog to the backend, not a catalog of its own', async () => {
    let sent: unknown;
    const base = transport([{ type: 'run.completed' }]);

    await runAgent({
      prompt: 'p',
      toolkit: echo,
      credentials: { email: 'a@b.c', password: 'x' },
      transport: {
        ...base,
        startRun: async (_token, request) => {
          sent = request.toolDefinitions;
          return Promise.resolve({ runId: 'run-1', generation: 'gen-1' });
        },
      },
    });

    expect(sent).toBe(echo.definitions);
  });

  it('reports a failed run rather than throwing', async () => {
    const result = await runAgent({
      prompt: 'p',
      toolkit: echo,
      credentials: { email: 'a@b.c', password: 'x' },
      transport: transport([{ type: 'run.failed' }]),
    });

    expect(result.outcome).toBe('failed');
  });

  it('honours a deadline supplied by the caller', async () => {
    let clock = 0;
    const result = await runAgent({
      prompt: 'p',
      toolkit: echo,
      credentials: { email: 'a@b.c', password: 'x' },
      transport: transport([{ type: 'model.delta' }, { type: 'model.delta' }]),
      deadlineMs: 1_500,
      now: () => {
        clock += 1_000;
        return clock;
      },
    });

    expect(result.outcome).toBe('exhausted');
  });
});

describe('toolResultFor', () => {
  it('hashes the canonical wrapper the backend verifies, not the payload alone', () => {
    const result = toolResultFor(toolRequest('demo.tool', 'read', {}), echo) as {
      receipt: { resultHash: string; outputBytes: number };
      structured: unknown;
      modelText: string;
    };
    const canonical = canonicalJson({
      error: null,
      modelText: result.modelText,
      structured: result.structured,
    });

    expect(result.receipt.resultHash).toBe(sha256(canonical));
    expect(result.receipt.outputBytes).toBe(Buffer.byteLength(canonical, 'utf8'));
  });

  it('turns a throwing toolkit into a failed result the model can read', () => {
    const result = toolResultFor(toolRequest('demo.tool', 'read', {}), {
      definitions: [],
      execute: () => {
        throw new Error('disk on fire');
      },
    }) as { status: string; error: { message: string } };

    expect(result.status).toBe('failed');
    expect(result.error.message).toBe('disk on fire');
  });

  it('never reports both a success and an error, which the backend refuses', () => {
    const ok = toolResultFor(toolRequest('demo.tool', 'read', {}), echo) as Record<string, unknown>;

    expect(ok.status).toBe('succeeded');
    expect(ok.error).toBeUndefined();
  });

  it('ties the receipt to the invocation it answers', () => {
    const result = toolResultFor(toolRequest('demo.tool', 'read', {}), echo) as {
      invocationId: string;
      receipt: { invocationId: string };
    };

    expect(result.receipt.invocationId).toBe(result.invocationId);
  });
});
