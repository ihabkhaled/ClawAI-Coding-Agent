import { afterEach, describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createAgent } from '../../src/sdk/create-agent';
import { capture, cleanupRuntimes, stateDir, workspace } from '../helpers/fake-runtime-server';
import { closeFlakyRuntimes, startFlakyRuntime } from '../helpers/flaky-runtime-server';

import type { AgentEvent } from '../../src/sdk/create-agent.types';
import type { FlakyCall, FlakyOptions } from '../helpers/flaky-runtime-server';

afterEach(async () => {
  await closeFlakyRuntimes();
  await cleanupRuntimes();
});

const memoryCalls = (calls: readonly FlakyCall[]) =>
  calls.filter((call) => call.route === 'memory');

async function cli(args: readonly string[], options: FlakyOptions = {}) {
  const runtime = await startFlakyRuntime(options);
  const { io, out, err } = capture();
  const code = await runHeadlessCli(
    ['-p', 'write hello', '--allow-tools', 'read,write', '--output-format', 'stream-json', ...args],
    { CLAW_TOKEN: 'secret-token-xyz', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
    io,
    { cwd: workspace() },
  );
  const events = out
    .join('')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentEvent);
  return { runtime, code, events, raw: out.join(''), err: err.join('') };
}

const started = (events: readonly AgentEvent[]) =>
  events.find((event) => event.type === 'run.started');

describe('a new thread does not ingest the account memories', () => {
  it('PATCHes a new thread exactly once with useMemory false', async () => {
    const { runtime, code, events } = await cli([]);

    expect(code).toBe(0);
    const patches = memoryCalls(runtime.calls);
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ useMemory: false });
    expect(started(events)).toMatchObject({ type: 'run.started', memory: 'off' });
    expect(events.some((event) => event.type === 'thread.memory-unchanged')).toBe(false);
  });

  it('treats --no-memory as the same default', async () => {
    const { runtime, code } = await cli(['--no-memory']);

    expect(code).toBe(0);
    expect(memoryCalls(runtime.calls)).toHaveLength(1);
  });

  it('sends nothing with --use-memory and reports the account default', async () => {
    const { runtime, code, events } = await cli(['--use-memory']);

    expect(code).toBe(0);
    expect(memoryCalls(runtime.calls)).toHaveLength(0);
    expect(started(events)).toMatchObject({ memory: 'account-default' });
  });

  it('sends nothing for a resumed thread and leaves memory out of run.started', async () => {
    const { runtime, code, events } = await cli(['--resume', 'thread-9']);

    expect(code).toBe(0);
    expect(runtime.calls.filter((call) => call.route === 'thread')).toHaveLength(0);
    expect(memoryCalls(runtime.calls)).toHaveLength(0);
    expect(started(events)).not.toHaveProperty('memory');
  });

  it.each([400, 403, 404])(
    'a %i from the PATCH is one event and the run continues',
    async (status) => {
      const { runtime, code, events, raw } = await cli([], {
        intercept: (call) => (call.route === 'memory' ? { status } : undefined),
      });

      expect(code).toBe(0);
      expect(memoryCalls(runtime.calls)).toHaveLength(1);
      expect(events.filter((event) => event.type === 'thread.memory-unchanged')).toEqual([
        { type: 'thread.memory-unchanged', status },
      ]);
      expect(started(events)).toMatchObject({ memory: 'account-default' });
      expect(raw).not.toContain('secret-token-xyz');
    },
  );

  it('retries a transient 503 on the PATCH through the resilience layer', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'memory' && call.count <= 2 ? { status: 503 } : undefined,
    });
    const events: AgentEvent[] = [];
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace(),
      backendUrl: runtime.url,
      permissions: { allow: ['read', 'write'] },
      retry: { now: () => 0, random: () => 0.5, sleep: () => Promise.resolve() },
    });

    const result = await agent.run('write hello', { onEvent: (event) => events.push(event) });

    expect(result.outcome).toBe('completed');
    expect(memoryCalls(runtime.calls)).toHaveLength(3);
    expect(events.filter((event) => event.type === 'run.retrying')).toHaveLength(2);
    expect(started(events)).toMatchObject({ memory: 'off' });
  });

  it('does not hide a real failure: a 401 on the PATCH fails the run', async () => {
    const { code } = await cli([], {
      intercept: (call) => (call.route === 'memory' ? { status: 401 } : undefined),
    });

    expect(code).toBe(3);
  });

  it('SDK: a second run on the same agent does not PATCH again', async () => {
    const runtime = await startFlakyRuntime();
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace(),
      backendUrl: runtime.url,
      permissions: { allow: ['read', 'write'] },
    });

    await agent.run('write hello');
    await agent.run('again');

    expect(memoryCalls(runtime.calls)).toHaveLength(1);
  });

  it('SDK: useMemory true leaves the thread on the account default', async () => {
    const runtime = await startFlakyRuntime();
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace(),
      backendUrl: runtime.url,
      permissions: { allow: ['read', 'write'] },
      useMemory: true,
    });

    await agent.run('write hello');

    expect(memoryCalls(runtime.calls)).toHaveLength(0);
  });
});

describe('--use-memory and --no-memory arguments', () => {
  const parse = (...args: string[]) => parseHeadlessArgs(['-p', 'x', ...args], {}, process.cwd());

  it('defaults to memory off', () => {
    const parsed = parse();

    expect(parsed.kind === 'run' && parsed.invocation.useMemory).toBeUndefined();
  });

  it('reads --use-memory, and accepts --no-memory as a no-op', () => {
    const on = parse('--use-memory');
    const off = parse('--no-memory');

    expect(on.kind === 'run' && on.invocation.useMemory).toBe(true);
    expect(off.kind === 'run' && off.invocation.useMemory).toBeUndefined();
  });

  it('rejects both together as a usage error', () => {
    const parsed = parse('--use-memory', '--no-memory');

    expect(parsed).toEqual({
      kind: 'usage',
      message: '--use-memory and --no-memory cannot be combined.',
    });
  });

  it('exits 2 before any request when both are given', async () => {
    const { io, err } = capture();

    const code = await runHeadlessCli(
      ['-p', 'x', '--use-memory', '--no-memory'],
      { CLAW_TOKEN: 't', CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: process.cwd() },
    );

    expect(code).toBe(2);
    expect(err.join('')).toContain('cannot be combined');
  });
});
