import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createAgent } from '../../src/sdk/create-agent';
import { capture, cleanupRuntimes, stateDir, workspace } from '../helpers/fake-runtime-server';
import { closeFlakyRuntimes, startFlakyRuntime } from '../helpers/flaky-runtime-server';

import type { AgentEvent, AgentRunCallOptions } from '../../src/sdk/create-agent.types';
import type { FlakyCall, FlakyOptions, FlakyReply } from '../helpers/flaky-runtime-server';

afterEach(async () => {
  await closeFlakyRuntimes();
  await cleanupRuntimes();
});

const fail =
  (route: FlakyCall['route'], times: number, reply: FlakyReply) =>
  (call: FlakyCall): FlakyReply | undefined =>
    call.route === route && call.count <= times ? reply : undefined;

/** A clock the retry logic can wait on without the test waiting. */
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

async function runAgainst(
  options: FlakyOptions,
  call: AgentRunCallOptions = {},
  retry: ReturnType<typeof clock>['retry'] | 'real' = clock().retry,
) {
  const runtime = await startFlakyRuntime(options);
  const root = workspace();
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 'test-token-abc' },
    workspaceRoot: root,
    backendUrl: runtime.url,
    permissions: { allow: ['read', 'write'] },
    ...(retry === 'real' ? {} : { retry }),
  });
  const result = await agent.run('write hello', {
    ...call,
    onEvent: (event) => events.push(event),
  });
  return { runtime, root, events, result };
}

const retrying = (events: AgentEvent[]) =>
  events.filter(
    (event): event is Extract<AgentEvent, { type: 'run.retrying' }> =>
      event.type === 'run.retrying',
  );

describe('a runtime that goes away and comes back', () => {
  it('survives 503 on the tool result and reuses one idempotency key', async () => {
    const { runtime, events, result, root } = await runAgainst({
      intercept: fail('results', 3, {
        status: 503,
        body: { message: 'Runtime state is unavailable' },
      }),
    });

    expect(result).toMatchObject({ outcome: 'completed', exitCode: 0, toolCalls: 1 });
    expect(readFileSync(path.join(root, 'hello.txt'), 'utf8')).toBe('from the agent');
    const posts = runtime.results();
    expect(posts).toHaveLength(4);
    const keys = posts.map((post) => post.body?.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^idem\./u);
    expect(new Set(posts.map((post) => JSON.stringify(post.body))).size).toBe(1);
    expect(
      retrying(events).map(({ attempt, waitMs, status }) => [attempt, waitMs, status]),
    ).toEqual([
      [1, 1_000, 503],
      [2, 2_000, 503],
      [3, 4_000, 503],
    ]);
  });

  it('survives 503 on create-thread and start-run, reusing the start idempotency key', async () => {
    const { runtime, result } = await runAgainst({
      intercept: (call) =>
        fail('thread', 1, { status: 503 })(call) ?? fail('start', 2, { status: 502 })(call),
    });

    expect(result.outcome).toBe('completed');
    const starts = runtime.calls.filter((call) => call.route === 'start');
    expect(starts).toHaveLength(3);
    expect(new Set(starts.map((call) => call.body?.idempotencyKey)).size).toBe(1);
  });

  it('survives a 503 when opening the event stream', async () => {
    const { result, runtime } = await runAgainst({ intercept: fail('stream', 2, { status: 503 }) });

    expect(result.outcome).toBe('completed');
    expect(runtime.calls.filter((call) => call.route === 'stream')).toHaveLength(3);
  });

  it('honours Retry-After on a 429, and caps it at 30 seconds', async () => {
    const { retry, sleeps } = clock();
    const first = await runAgainst(
      { intercept: fail('results', 1, { status: 429, headers: { 'Retry-After': '2' } }) },
      {},
      retry,
    );
    expect(first.result.outcome).toBe('completed');
    expect(sleeps).toEqual([2_000]);

    const second = clock();
    await runAgainst(
      { intercept: fail('results', 1, { status: 429, headers: { 'Retry-After': '600' } }) },
      {},
      second.retry,
    );
    expect(second.sleeps).toEqual([30_000]);
  });

  it('reconnects from the last event after a dropped stream, running the tool once', async () => {
    const { runtime, result, events } = await runAgainst({ cutStream: { 1: 'reset' } });

    expect(result).toMatchObject({ outcome: 'completed', toolCalls: 1, text: 'Writing done.' });
    const streams = runtime.calls.filter((call) => call.route === 'stream');
    expect(streams.map((call) => call.after)).toEqual([0, 2]);
    expect(runtime.results()).toHaveLength(1);
    expect(retrying(events)).toHaveLength(1);
    expect(retrying(events)[0]?.code).toBeDefined();
  });

  it('reconnects when the stream reports the runtime state is unavailable', async () => {
    const { runtime, result } = await runAgainst({ cutStream: { 1: 'frame' } });

    expect(result).toMatchObject({ outcome: 'completed', toolCalls: 1 });
    expect(runtime.results()).toHaveLength(1);
  });

  it('survives the tool result socket being reset', async () => {
    const { result, events } = await runAgainst({ intercept: fail('results', 2, 'reset') });

    expect(result.outcome).toBe('completed');
    expect(retrying(events).map((event) => event.code)).toHaveLength(2);
  });
});

describe('a runtime that does not come back', () => {
  it('fails cleanly with exit 1 and a plain message after 12 attempts', async () => {
    const { retry, sleeps } = clock();
    const { runtime, result } = await runAgainst(
      {
        intercept: fail('results', 99, {
          status: 503,
          body: { message: 'Runtime state is unavailable' },
        }),
      },
      {},
      retry,
    );

    expect(runtime.results()).toHaveLength(12);
    expect(sleeps).toHaveLength(11);
    expect(result.outcome).toBe('failed');
    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/runtime stayed unavailable: gave up after 12 attempts/u);
    expect(result.runLost).toBeUndefined();
  });

  it('gives up on the 5 minute budget when attempts are not the limit', async () => {
    const ticking = clock();
    const { runtime, result } = await runAgainst(
      { intercept: fail('results', 999, { status: 503 }) },
      {},
      { ...ticking.retry, maxAttempts: 500 } as ReturnType<typeof clock>['retry'],
    );

    expect(result.exitCode).toBe(1);
    expect(runtime.results().length).toBeLessThan(500);
    expect(ticking.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(300_000);
  });
});

describe('failures that are never retried', () => {
  it('does not retry a 401, and exits 3', async () => {
    const { runtime, result } = await runAgainst({
      intercept: fail('results', 99, { status: 401, body: { message: 'Unauthorized' } }),
    });

    expect(runtime.results()).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'unauthenticated', exitCode: 3 });
  });

  it.each([400, 422])('does not retry a %i', async (status) => {
    const { runtime, result, events } = await runAgainst({
      intercept: fail('results', 99, { status, body: { message: 'invalid' } }),
    });

    expect(runtime.results()).toHaveLength(1);
    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
    expect(retrying(events)).toEqual([]);
  });
});

describe('stopping during a wait', () => {
  it('ends as cancelled when the caller aborts while a call waits to retry', async () => {
    const controller = new AbortController();
    const { runtime, result } = await runAgainst(
      { intercept: fail('results', 99, { status: 503 }) },
      { signal: controller.signal },
      {
        ...clock().retry,
        sleep: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    );

    expect(result).toMatchObject({ outcome: 'cancelled', exitCode: 130 });
    expect(runtime.results()).toHaveLength(1);
  });

  it('ends as exhausted when --max-duration passes during a wait (real timers)', async () => {
    const started = Date.now();
    const { runtime, result } = await runAgainst(
      { intercept: fail('results', 99, { status: 503 }) },
      { maxDurationMs: 150 },
      'real',
    );

    expect(result).toMatchObject({ outcome: 'exhausted', exitCode: 5 });
    expect(runtime.results()).toHaveLength(1);
    // The first backoff is about a second; the guard cut it short.
    expect(Date.now() - started).toBeLessThan(900);
  });
});

describe('the headless CLI', () => {
  it('prints run.retrying and still exits 0 across a 503 (real timers)', async () => {
    const runtime = await startFlakyRuntime({ intercept: fail('results', 1, { status: 503 }) });
    const { io, out } = capture();

    const code = await runHeadlessCli(
      ['-p', 'write hello', '--allow-tools', 'read,write', '--output-format', 'stream-json'],
      { CLAW_TOKEN: 'test-token-abc', CLAW_BACKEND_URL: runtime.url, CLAW_STATE_DIR: stateDir() },
      io,
      { cwd: workspace() },
    );

    const lines = out
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { type: string });
    expect(code).toBe(0);
    const notice = lines.find((line) => line.type === 'run.retrying');
    expect(notice).toMatchObject({ attempt: 1, status: 503 });
    expect(lines.at(-1)?.type).toBe('run.finished');
  }, 15_000);
});
