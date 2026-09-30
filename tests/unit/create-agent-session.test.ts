import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { HeadlessRunRequest } from '../../src/headless/headless-transport.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentConfig } from '../../src/sdk/create-agent.types';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-agent-session-'));
  created.push(directory);
  return directory;
}

function request(toolName: string, operation: string, args: unknown): HeadlessStreamEvent {
  return {
    type: 'tool.requested',
    payload: { invocationId: 'invocation-1', toolName, operation, invocation: { arguments: args } },
  };
}

function fake(events: readonly HeadlessStreamEvent[]) {
  const started: HeadlessRunRequest[] = [];
  const submitted: unknown[] = [];
  const createThread = vi.fn(async () => Promise.resolve('thread-new'));
  const transport: RuntimeTransportPort = {
    signIn: async () => Promise.resolve('t'),
    createThread,
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
  };
  return { transport, started, submitted, createThread };
}

function agent(transport: RuntimeTransportPort, extra: Partial<AgentConfig> = {}) {
  return createAgent({ auth: { token: 't' }, workspaceRoot: workspace(), transport, ...extra });
}

describe('createAgent sessions', () => {
  it('starts on the given thread and creates none', async () => {
    const { transport, started, createThread } = fake([{ type: 'run.completed' }]);
    const instance = agent(transport, { threadId: 'thread-9' });

    expect(instance.threadId).toBe('thread-9');
    const result = await instance.run('again');

    expect(createThread).not.toHaveBeenCalled();
    expect(started[0]?.threadId).toBe('thread-9');
    expect(result.threadId).toBe('thread-9');
  });

  it('exposes the thread of the first run and reuses it for the next', async () => {
    const { transport, started, createThread } = fake([{ type: 'run.completed' }]);
    const instance = agent(transport);

    expect(instance.threadId).toBeUndefined();
    await instance.run('one');
    await instance.run('two');

    expect(instance.threadId).toBe('thread-new');
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(started.map((body) => body.threadId)).toEqual(['thread-new', 'thread-new']);
  });

  it('rejects a thread id that could reshape a URL', () => {
    const { transport } = fake([]);

    expect(() => agent(transport, { threadId: '../admin' })).toThrow(/thread id/u);
    expect(() => agent(transport, { threadId: '' })).toThrow(/thread id/u);
  });
});

describe('createAgent system prompt', () => {
  it('frames operator instructions ahead of the task and adds nothing else', async () => {
    const { transport, started } = fake([{ type: 'run.completed' }]);

    await agent(transport, { systemPrompt: 'Answer in French.' }).run('bonjour');

    expect(started[0]?.prompt).toBe(
      '<operator-instructions>\nAnswer in French.\n</operator-instructions>\n\nbonjour',
    );
  });

  it('sends the prompt untouched when there are no instructions', async () => {
    const { transport, started } = fake([{ type: 'run.completed' }]);

    await agent(transport).run('plain');

    expect(started[0]?.prompt).toBe('plain');
  });

  it('bounds the size and refuses an empty prompt', () => {
    const { transport } = fake([]);

    expect(() => agent(transport, { systemPrompt: 'x'.repeat(20_001) })).toThrow(/longer than/u);
    expect(() => agent(transport, { systemPrompt: '   ' })).toThrow(/empty/u);
    expect(() => agent(transport, { systemPrompt: 'x'.repeat(20_000) })).not.toThrow();
  });

  it('never puts the instructions in an event or an error', async () => {
    const secretPrompt = 'internal rule: codename BLUEFIN';
    const { transport } = fake([]);
    const failing: RuntimeTransportPort = {
      ...transport,
      startRun: async (_token, body) =>
        Promise.reject(new Error(`bad request for ${body.prompt.slice(0, 200)}`)),
    };
    const seen: string[] = [];

    const result = await agent(failing, {
      auth: { token: 'tok-long-secret' },
      systemPrompt: secretPrompt,
    }).run('x', {
      onEvent: (event) => seen.push(JSON.stringify(event)),
    });

    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('[redacted-instructions]');
    expect(result.error).not.toContain('BLUEFIN');
    expect(seen.join('')).not.toContain('BLUEFIN');
  });
});

describe('createAgent permission modes and tool lists', () => {
  it('plan mode refuses a write even when it was granted', async () => {
    const root = workspace();
    const { transport, submitted } = fake([
      request('workspace.file', 'create', { path: 'a.txt', content: 'x' }),
      { type: 'run.completed' },
    ]);

    const result = await agent(transport, {
      workspaceRoot: root,
      permissions: { allow: ['read', 'write'] },
      permissionMode: 'plan',
    }).run('p');

    expect(result.deniedCalls).toBe(1);
    expect(() => readFileSync(path.join(root, 'a.txt'))).toThrow();
    expect(submitted[0]).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('ask mode runs a write only once the callback approves it', async () => {
    const root = workspace();
    const ask = vi.fn(() => true);
    const { transport } = fake([
      request('workspace.file', 'create', { path: 'a.txt', content: 'ok' }),
      { type: 'run.completed' },
    ]);

    await agent(transport, {
      workspaceRoot: root,
      permissions: { allow: ['write'], approve: ask },
      permissionMode: 'ask',
    }).run('p');

    expect(ask).toHaveBeenCalledTimes(1);
    expect(readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('ok');
  });

  it('accept-edits writes without asking, and denies a command with nobody to ask', async () => {
    const root = workspace();
    const { transport, submitted } = fake([
      request('workspace.file', 'create', { path: 'a.txt', content: 'ok' }),
      request('workspace.command', 'run', { executable: 'node', arguments: ['-v'] }),
      { type: 'run.completed' },
    ]);

    const result = await agent(transport, {
      workspaceRoot: root,
      permissions: { allow: ['write', 'command'] },
      permissionMode: 'accept-edits',
    }).run('p');

    expect(readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('ok');
    expect(result.deniedCalls).toBe(1);
    expect(submitted[1]).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('refuses a call the deny list names, even though its category is granted', async () => {
    const root = workspace();
    const { transport, submitted } = fake([
      request('workspace.file', 'create', { path: 'a.txt', content: 'x' }),
      { type: 'run.completed' },
    ]);

    await agent(transport, {
      workspaceRoot: root,
      permissions: { allow: ['read', 'write'] },
      allowedTools: ['workspace.file.*'],
      disallowedTools: ['workspace.file.create'],
    }).run('p');

    expect(() => readFileSync(path.join(root, 'a.txt'))).toThrow();
    expect(submitted[0]).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('offers the model only the operations the lists leave', async () => {
    const { transport, started } = fake([{ type: 'run.completed' }]);

    await agent(transport, {
      permissions: { allow: ['read', 'write', 'git'] },
      allowedTools: ['workspace.file.read'],
    }).run('p');

    expect(started[0]?.toolDefinitions).toMatchObject([
      { name: 'workspace.file', operations: ['read'] },
    ]);
  });
});
