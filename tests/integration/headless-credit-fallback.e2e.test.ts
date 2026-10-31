import { afterEach, describe, expect, it } from 'vitest';

import { runHeadlessCli } from '../../src/headless/headless-cli';
import { capture, cleanupRuntimes, stateDir, workspace } from '../helpers/fake-runtime-server';
import { closeFlakyRuntimes, startFlakyRuntime } from '../helpers/flaky-runtime-server';

import type { FlakyCall, FlakyReply } from '../helpers/flaky-runtime-server';

afterEach(async () => {
  await closeFlakyRuntimes();
  await cleanupRuntimes();
});

/** The refusal the runtime start endpoint gives when a credit model has no credit left. */
const noCredit: FlakyReply = {
  status: 402,
  body: { message: 'Not enough credit', code: 'PAYG_CREDIT_EXHAUSTED' },
};

const modelOf = (call: FlakyCall): unknown => call.body?.model;
const starts = (calls: FlakyCall[]) => calls.filter((call) => call.route === 'start');

const env = (url: string) => ({
  CLAW_TOKEN: 'test-token-abc',
  CLAW_BACKEND_URL: url,
  CLAW_STATE_DIR: stateDir(),
});
const base = ['-p', 'write hello', '--allow-tools', 'read,write', '--model', 'credit-m'];

describe('the headless CLI against a start endpoint that answers 402 credit exhausted', () => {
  it('falls back to the second model, completes, and names both models', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'start' && modelOf(call) === 'credit-m' ? noCredit : undefined,
    });
    const { io, err } = capture();

    const code = await runHeadlessCli(
      [...base, '--fallback-model', 'included-m'],
      env(runtime.url),
      io,
      { cwd: workspace() },
    );

    expect(code).toBe(0);
    expect(starts(runtime.calls).map(modelOf)).toEqual(['credit-m', 'included-m']);
    // The failed run was admitted under its request id; reusing it for the
    // fallback is refused by the backend as a conflicting admission (409).
    const [first, second] = starts(runtime.calls);
    expect(first?.body?.clientRequestId).toEqual(expect.any(String));
    expect(second?.body?.clientRequestId).not.toEqual(first?.body?.clientRequestId);
    expect(second?.body?.idempotencyKey).not.toEqual(first?.body?.idempotencyKey);
    expect(err.join('')).toContain('OLLAMA/credit-m');
    expect(err.join('')).toContain('OLLAMA/included-m');
  }, 20_000);

  it('stream-json carries a model.fallback event with from and to', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'start' && modelOf(call) === 'credit-m' ? noCredit : undefined,
    });
    const { io, out } = capture();

    const code = await runHeadlessCli(
      [...base, '--fallback-model', 'included-m', '--output-format', 'stream-json'],
      env(runtime.url),
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
      from: 'OLLAMA/credit-m',
      to: 'OLLAMA/included-m',
    });
    expect(lines.at(-1)?.type).toBe('run.finished');
  }, 20_000);

  it('with no fallback configured: exits non-zero and the output carries the credit message', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) => (call.route === 'start' ? noCredit : undefined),
    });
    const { io, err, out } = capture();

    const code = await runHeadlessCli(
      ['-p', 'write hello', '--allow-tools', 'read,write', '--model', 'credit-m'],
      env(runtime.url),
      io,
      { cwd: workspace() },
    );

    expect(code).not.toBe(0);
    expect(starts(runtime.calls)).toHaveLength(1);
    expect(`${err.join('')}${out.join('')}`).toMatch(/Not enough credit|PAYG_CREDIT_EXHAUSTED/u);
  }, 20_000);
});

describe('the headless CLI against a start endpoint that answers 500', () => {
  it('does not fall back: the fallback model is never called and the run fails', async () => {
    const runtime = await startFlakyRuntime({
      intercept: (call) =>
        call.route === 'start' && modelOf(call) === 'credit-m'
          ? { status: 500, body: { message: 'boom' } }
          : undefined,
    });
    const { io, err } = capture();

    const code = await runHeadlessCli(
      [...base, '--fallback-model', 'included-m'],
      env(runtime.url),
      io,
      { cwd: workspace() },
    );

    expect(code).not.toBe(0);
    expect(starts(runtime.calls).every((call) => modelOf(call) === 'credit-m')).toBe(true);
    expect(err.join('')).not.toContain('continuing on');
  }, 30_000);
});
