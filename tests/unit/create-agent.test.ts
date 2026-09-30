import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { createAgent } from '../../src/sdk/create-agent';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { HeadlessRunRequest } from '../../src/headless/headless-transport.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentConfig, AgentEvent } from '../../src/sdk/create-agent.types';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-create-agent-'));
  created.push(directory);
  return directory;
}

function request(toolName: string, operation: string, args: unknown): HeadlessStreamEvent {
  return {
    type: 'tool.requested',
    payload: { invocationId: 'invocation-1', toolName, operation, invocation: { arguments: args } },
  };
}

interface Fake {
  readonly transport: RuntimeTransportPort;
  readonly submitted: unknown[];
  readonly started: HeadlessRunRequest[];
  readonly signIn: ReturnType<typeof vi.fn>;
}

function fake(
  events: readonly HeadlessStreamEvent[],
  overrides: Partial<RuntimeTransportPort> = {},
): Fake {
  const submitted: unknown[] = [];
  const started: HeadlessRunRequest[] = [];
  const signIn = vi.fn(async () => Promise.resolve('signed-token'));
  return {
    submitted,
    started,
    signIn,
    transport: {
      signIn,
      createThread: async () => Promise.resolve('thread-1'),
      startRun: async (_token, body) => {
        started.push(body);
        return Promise.resolve({ runId: 'run-1', generation: 'gen-1' });
      },
      submitResult: async (_token, _run, _epochs, result) => {
        submitted.push(result);
        return Promise.resolve({});
      },
      events: async function* stream() {
        for (const event of events) yield await Promise.resolve(event);
      },
      ...overrides,
    },
  };
}

function agent(transport: RuntimeTransportPort, extra: Partial<AgentConfig> = {}) {
  return createAgent({ auth: { token: 't' }, workspaceRoot: workspace(), transport, ...extra });
}

describe('createAgent', () => {
  it('streams typed events and collects the answer text', async () => {
    const { transport } = fake([
      { type: 'model.delta', payload: { text: 'Hel' } },
      { type: 'model.delta', payload: { text: 'lo' } },
      { type: 'run.completed' },
    ]);
    const events: AgentEvent[] = [];

    const result = await agent(transport).run('hi', { onEvent: (event) => events.push(event) });

    expect(result).toMatchObject({
      outcome: 'completed',
      exitCode: 0,
      text: 'Hello',
      runId: 'run-1',
    });
    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'text',
      'text',
      'runtime',
      'run.finished',
    ]);
  });

  it('uses a given token without signing in, and signs in with credentials otherwise', async () => {
    const tokenRun = fake([{ type: 'run.completed' }]);
    await agent(tokenRun.transport).run('p');
    expect(tokenRun.signIn).not.toHaveBeenCalled();

    const passwordRun = fake([{ type: 'run.completed' }]);
    await agent(passwordRun.transport, { auth: { email: 'a@b.c', password: 'pw' } }).run('p');
    expect(passwordRun.signIn).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
  });

  it('executes a granted write locally and reports the call and its result', async () => {
    const root = workspace();
    const { transport, submitted } = fake([
      request('workspace.file', 'create', { path: 'out/a.txt', content: 'hi' }),
      { type: 'run.completed' },
    ]);
    const events: AgentEvent[] = [];

    const result = await agent(transport, {
      workspaceRoot: root,
      permissions: { allow: ['write'] },
    }).run('write it', { onEvent: (event) => events.push(event) });

    expect(result.toolCalls).toBe(1);
    expect(readFileSync(path.join(root, 'out', 'a.txt'), 'utf8')).toBe('hi');
    expect(submitted[0]).toMatchObject({ status: 'succeeded' });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'tool.call', toolName: 'workspace.file' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool.result', ok: true }));
  });

  it('refuses a tool outside the granted categories and tells the model why', async () => {
    const root = workspace();
    const { transport, submitted } = fake([
      request('workspace.file', 'create', { path: 'a.txt', content: 'x' }),
      { type: 'run.completed' },
    ]);

    const result = await agent(transport, { workspaceRoot: root }).run('p');

    expect(result.deniedCalls).toBe(1);
    expect(submitted[0]).toMatchObject({
      status: 'failed',
      error: { code: 'PERMISSION_DENIED' },
    });
    expect(() => readFileSync(path.join(root, 'a.txt'))).toThrow();
  });

  it('asks the approval callback and honours a decline', async () => {
    const approve = vi.fn(() => false);
    const { transport } = fake([request('workspace.file', 'list', {}), { type: 'run.failed' }]);
    const events: AgentEvent[] = [];

    const result = await agent(transport, { permissions: { allow: ['read'], approve } }).run('p', {
      onEvent: (event) => events.push(event),
    });

    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'read', toolName: 'workspace.file', operation: 'list' }),
    );
    expect(events).toContainEqual({
      type: 'tool.denied',
      toolName: 'workspace.file',
      operation: 'list',
    });
    // A failure that followed a refusal is a permission problem: exit 4, not 1.
    expect(result).toMatchObject({ outcome: 'blocked', exitCode: 4 });
  });

  it('runs a call the approval callback accepts', async () => {
    const approve = vi.fn(async () => Promise.resolve(true));
    const { transport, submitted } = fake([
      request('workspace.file', 'list', {}),
      { type: 'run.completed' },
    ]);

    await agent(transport, { permissions: { allow: ['read'], approve } }).run('p');

    expect(submitted[0]).toMatchObject({ status: 'succeeded' });
  });

  it('reports a tool that throws as a failed result event, and the run continues', async () => {
    const { transport, submitted } = fake([
      request('workspace.file', 'read', {}),
      { type: 'run.completed' },
    ]);
    const events: AgentEvent[] = [];

    const result = await agent(transport).run('p', { onEvent: (event) => events.push(event) });

    expect(result.outcome).toBe('completed');
    expect(submitted[0]).toMatchObject({ status: 'failed', error: { code: 'TOOL_FAILED' } });
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool.result', ok: false }));
  });

  it('sends only the granted operations and the max-turn budget to the runtime', async () => {
    const run = fake([{ type: 'run.completed' }]);

    await agent(run.transport, { permissions: { allow: ['read'] }, model: 'm1' }).run('p', {
      maxTurns: 3,
    });

    const body = run.started[0];
    expect(body?.model).toBe('m1');
    expect(body?.budget).toMatchObject({ maxModelTurns: 3, maxToolRounds: 3 });
    expect(body?.toolDefinitions).toEqual([
      expect.objectContaining({
        name: 'workspace.file',
        operations: ['read', 'list', 'glob', 'search', 'stat'],
      }),
      expect.objectContaining({ name: 'workspace.notes' }),
    ]);
  });

  it('reports a refused sign-in as an auth error, and never repeats the password', async () => {
    const { transport } = fake([], {
      signIn: async () => Promise.reject(new RuntimeHttpError('/auth/login', 401, 'bad secret-pw')),
    });

    const result = await agent(transport, {
      auth: { email: 'a@b.c', password: 'secret-pw' },
    }).run('p');

    expect(result).toMatchObject({ outcome: 'unauthenticated', exitCode: 3 });
    expect(result.error).not.toContain('secret-pw');
    expect(result.error).toContain('[redacted]');
  });

  it('reports a refused token after sign-in as an auth error', async () => {
    const { transport } = fake([], {
      createThread: async () => Promise.reject(new RuntimeHttpError('/chat-threads', 401, '')),
    });

    const result = await agent(transport).run('p');

    expect(result.exitCode).toBe(3);
  });

  it('reports a server failure as a failed run', async () => {
    const { transport } = fake([], {
      startRun: async () => Promise.reject(new RuntimeHttpError('/runs', 500, 'down')),
    });

    const result = await agent(transport).run('p');

    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
  });

  it('counts granted calls and reports blocked when the runtime rejects the run after a refusal', async () => {
    const { transport } = fake(
      [
        request('workspace.file', 'list', {}),
        request('workspace.file', 'create', { path: 'a.txt', content: 'x' }),
      ],
      {
        submitResult: async (_token, _run, _epochs, result) =>
          (result as { status: string }).status === 'failed'
            ? Promise.reject(new RuntimeHttpError('/results', 422, 'unrepairable'))
            : Promise.resolve({}),
      },
    );

    const result = await agent(transport, { permissions: { allow: ['read'] } }).run('p');

    expect(result).toMatchObject({
      outcome: 'blocked',
      exitCode: 4,
      toolCalls: 1,
      deniedCalls: 1,
    });
  });

  it('ends an aborted run as cancelled with exit 130', async () => {
    const controller = new AbortController();
    const { transport } = fake([], {
      events: async function* stream(_token, _run, signal) {
        yield await Promise.resolve({ type: 'model.delta', payload: { text: 'a' } });
        controller.abort();
        if (signal?.aborted === true) throw new Error('aborted');
        yield { type: 'run.completed' };
      },
    });

    const result = await agent(transport).run('p', { signal: controller.signal });

    expect(result).toMatchObject({ outcome: 'cancelled', exitCode: 130 });
  });

  it('reports an abort that arrives before the run starts as cancelled', async () => {
    const controller = new AbortController();
    const { transport } = fake([], {
      createThread: async () => {
        controller.abort();
        return Promise.reject(new Error('The operation was aborted'));
      },
    });

    const result = await agent(transport).run('p', { signal: controller.signal });

    expect(result.exitCode).toBe(130);
  });
});
