import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createAgent } from '../../src/sdk/create-agent';
import { capture, cleanupRuntimes, stateDir, workspace } from '../helpers/fake-runtime-server';
import { closeFlakyRuntimes, startFlakyRuntime } from '../helpers/flaky-runtime-server';

import type { AgentConfig, AgentEvent } from '../../src/sdk/create-agent.types';
import type { FlakyCall, FlakyReply } from '../helpers/flaky-runtime-server';

afterEach(async () => {
  await closeFlakyRuntimes();
  await cleanupRuntimes();
});

const limited: FlakyReply = {
  status: 429,
  body: { message: 'Too many requests' },
  headers: { 'Retry-After': '1' },
};

/** A clock the retry logic waits on without the test waiting; records each wait. */
function clock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    retry: {
      now: () => time,
      random: () => 0.5,
      sleep: (ms: number): Promise<void> => {
        sleeps.push(ms);
        time += ms;
        return Promise.resolve();
      },
    },
  };
}

const modelOf = (call: FlakyCall): unknown => call.body?.model;

async function run(
  intercept: (call: FlakyCall) => FlakyReply | undefined,
  config: Partial<AgentConfig>,
) {
  const runtime = await startFlakyRuntime({ intercept });
  const waits = clock();
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 'test-token-abc' },
    workspaceRoot: workspace(),
    backendUrl: runtime.url,
    permissions: { allow: ['read', 'write'] },
    model: 'primary-m',
    provider: 'OLLAMA',
    retry: waits.retry,
    ...config,
  });
  const result = await agent.run('write hello', { onEvent: (event) => events.push(event) });
  return { runtime, waits, events, result };
}

const fallbacks = (events: AgentEvent[]) =>
  events.filter((event) => event.type === 'model.fallback');

describe('a model that is rate limited (429 with Retry-After)', () => {
  it('at the start: retries 4 times, then moves to the fallback and completes', async () => {
    const { runtime, waits, events, result } = await run(
      (call) => (call.route === 'start' && modelOf(call) === 'primary-m' ? limited : undefined),
      { fallbackModels: [{ model: 'backup-m' }] },
    );

    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0 });
    const starts = runtime.calls.filter((call) => call.route === 'start');
    expect(starts.map(modelOf)).toEqual([
      'primary-m',
      'primary-m',
      'primary-m',
      'primary-m',
      'backup-m',
    ]);
    // The primary's tries share one key; the fallback is a different request.
    expect(new Set(starts.slice(0, 4).map((call) => call.body?.idempotencyKey)).size).toBe(1);
    expect(starts[4]?.body?.idempotencyKey).not.toBe(starts[0]?.body?.idempotencyKey);
    expect(waits.sleeps).toEqual([1_000, 1_000, 1_000]);
    expect(fallbacks(events)).toEqual([
      { type: 'model.fallback', from: 'OLLAMA/primary-m', to: 'OLLAMA/backup-m' },
    ]);
  });

  it('in the middle of the run: continues on the fallback in the same thread', async () => {
    const { runtime, events, result } = await run(
      (call) => (call.route === 'results' && call.count <= 4 ? limited : undefined),
      { fallbackModels: [{ provider: 'GEMINI', model: 'backup-m' }] },
    );

    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0 });
    expect(runtime.results()).toHaveLength(5);
    const starts = runtime.calls.filter((call) => call.route === 'start');
    expect(starts.map((call) => [call.body?.provider, call.body?.model])).toEqual([
      ['OLLAMA', 'primary-m'],
      ['GEMINI', 'backup-m'],
    ]);
    expect(starts[0]?.body?.threadId).toBe(starts[1]?.body?.threadId);
    expect(starts[1]?.body?.prompt).toMatch(/rate limited.*Task:\nwrite hello$/su);
    expect(starts[0]?.body?.prompt).toBe('write hello');
    expect(fallbacks(events)).toEqual([
      { type: 'model.fallback', from: 'OLLAMA/primary-m', to: 'GEMINI/backup-m' },
    ]);
  });

  it('with no fallback configured: ends after 4 tries with a clear error, exit 1', async () => {
    const { runtime, waits, events, result } = await run(
      (call) => (call.route === 'results' ? limited : undefined),
      {},
    );

    expect(runtime.results()).toHaveLength(4);
    expect(waits.sleeps).toEqual([1_000, 1_000, 1_000]);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
    expect(result.error).toMatch(/selected model is rate limited.*Choose another model/su);
    expect(fallbacks(events)).toEqual([]);
  });

  it('at the start with no fallback: the same clear error, never a hang', async () => {
    const { runtime, result } = await run(
      (call) => (call.route === 'start' ? limited : undefined),
      {},
    );

    expect(runtime.calls.filter((call) => call.route === 'start')).toHaveLength(4);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
    expect(result.error).toMatch(/rate limited/u);
  });

  it('when every model is limited: each is tried once, then the error ends the run', async () => {
    const { runtime, events, result } = await run(
      (call) => (call.route === 'start' ? limited : undefined),
      { fallbackModels: [{ model: 'backup-m' }, { model: 'primary-m' }, { model: 'backup-m' }] },
    );

    const starts = runtime.calls.filter((call) => call.route === 'start');
    // The repeats of the primary and of the backup are dropped: two models, 4 tries each.
    expect(starts.map(modelOf)).toEqual([
      ...Array<string>(4).fill('primary-m'),
      ...Array<string>(4).fill('backup-m'),
    ]);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
    expect(result.error).toMatch(/rate limited/u);
    expect(fallbacks(events)).toHaveLength(1);
  });

  it('does not fall back on a cancel that arrives while the run is limited', async () => {
    const controller = new AbortController();
    const runtime = await startFlakyRuntime({
      intercept: (call) => (call.route === 'results' ? limited : undefined),
    });
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace(),
      backendUrl: runtime.url,
      permissions: { allow: ['read', 'write'] },
      model: 'primary-m',
      fallbackModels: [{ model: 'backup-m' }],
      retry: {
        ...clock().retry,
        sleep: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    });
    const result = await agent.run('write hello', { signal: controller.signal });

    expect(result).toMatchObject({ outcome: 'cancelled', exitCode: 130 });
    expect(runtime.calls.filter((call) => call.route === 'start')).toHaveLength(1);
  });
});

describe('the headless CLI with a rate limited model (real timers, Retry-After 0)', () => {
  const instant: FlakyReply = { ...limited, headers: { 'Retry-After': '0' } };
  const env = (url: string) => ({
    CLAW_TOKEN: 'test-token-abc',
    CLAW_BACKEND_URL: url,
    CLAW_STATE_DIR: stateDir(),
  });
  const base = ['-p', 'write hello', '--allow-tools', 'read,write', '--model', 'primary-m'];

  it('--fallback-model switches, prints a [model] line and exits 0', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'start' && modelOf(call) === 'primary-m' ? instant : undefined,
    });
    const { io, err } = capture();

    const code = await runHeadlessCli(
      [...base, '--fallback-model', 'GEMINI/backup-m'],
      env(runtime.url),
      io,
      { cwd: workspace() },
    );

    expect(code).toBe(0);
    expect(err.join('')).toContain(
      '[model] OLLAMA/primary-m is rate limited; continuing on GEMINI/backup-m',
    );
  }, 20_000);

  it('CLAW_FALLBACK_MODELS works the same, and stream-json carries model.fallback', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'start' && modelOf(call) === 'primary-m' ? instant : undefined,
    });
    const { io, out } = capture();

    const code = await runHeadlessCli(
      [...base, '--output-format', 'stream-json'],
      { ...env(runtime.url), CLAW_FALLBACK_MODELS: 'backup-m' },
      io,
      { cwd: workspace() },
    );

    const lines = out
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string });
    expect(code).toBe(0);
    expect(lines.find((line) => line.type === 'model.fallback')).toMatchObject({
      from: 'OLLAMA/primary-m',
      to: 'OLLAMA/backup-m',
    });
    expect(lines.at(-1)?.type).toBe('run.finished');
  }, 20_000);

  it('without a fallback: exit 1 and a clear message', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) => (call.route === 'start' ? instant : undefined),
    });
    const { io, err } = capture();

    const code = await runHeadlessCli(
      ['-p', 'write hello', '--allow-tools', 'read,write'],
      env(runtime.url),
      io,
      { cwd: workspace() },
    );

    expect(code).toBe(1);
    expect(runtime.calls.filter((call) => call.route === 'start')).toHaveLength(4);
    expect(err.join('')).toMatch(/rate limited/u);
  }, 20_000);
});
