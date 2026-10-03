import { describe, expect, it, vi } from 'vitest';

import { RuntimeRateLimitedError } from '../../src/headless/runtime-rate-limited-error';
import { runWithFallbacks } from '../../src/sdk/agent-run-fallback';
import {
  fallbacksAfter,
  isRateLimitedTerminal,
  resolvedFallbacks,
} from '../../src/sdk/model-fallback';

import type { AttemptInput, AttemptOutcome } from '../../src/sdk/agent-run-fallback';

const primary = { provider: 'OLLAMA', model: 'a' };
const limited = (): RuntimeRateLimitedError =>
  new RuntimeRateLimitedError(4, 1_000, new Error('x'));

const outcome = (swallowed: boolean, toolCalls = 1): AttemptOutcome => ({
  report: { outcome: swallowed ? 'failed' : 'completed', toolCalls, terminalEvent: 'run.failed' },
  runId: 'run',
  threadId: 'thread',
  swallowed,
});

/** An attempt that starts on its target, as the real one does, then plays `script`. */
function scripted(script: ((input: AttemptInput) => AttemptOutcome | Error)[]) {
  const seen: AttemptInput[] = [];
  const attempt = (input: AttemptInput): Promise<AttemptOutcome> => {
    seen.push(input);
    input.progress.used = input.target;
    input.progress.rest = [...input.candidates];
    const step = script[seen.length - 1];
    const result = step?.(input);
    if (result === undefined) return Promise.reject(new Error('unscripted attempt'));
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { seen, attempt };
}

const config = (extra: Partial<Parameters<typeof runWithFallbacks>[0]> = {}) => ({
  primary,
  fallbacks: [{ model: 'b' }, { model: 'c' }],
  prompt: 'do it',
  deadlineMs: 100_000,
  now: () => 0,
  signal: undefined,
  onModelFallback: undefined,
  ...extra,
});

describe('runWithFallbacks', () => {
  it('returns the first attempt untouched when nothing is limited', async () => {
    const { seen, attempt } = scripted([() => outcome(false, 3)]);
    const onModelFallback = vi.fn();

    await expect(runWithFallbacks(config({ onModelFallback }), attempt)).resolves.toMatchObject({
      outcome: 'completed',
      toolCalls: 3,
      runId: 'run',
    });
    expect(seen).toHaveLength(1);
    expect(onModelFallback).not.toHaveBeenCalled();
  });

  it('continues on the next model after a limited run, with the continuation prompt, and adds the tool calls', async () => {
    const { seen, attempt } = scripted([() => outcome(true, 2), () => outcome(false, 5)]);
    const onModelFallback = vi.fn();

    const result = await runWithFallbacks(config({ onModelFallback }), attempt);

    expect(result).toMatchObject({ outcome: 'completed', toolCalls: 7 });
    expect(onModelFallback).toHaveBeenCalledWith({ from: 'OLLAMA/a', to: 'OLLAMA/b' });
    expect(seen[0]?.prompt).toBe('do it');
    expect(seen[1]?.prompt).toMatch(/rate limited.*Task:\ndo it$/su);
    expect(seen[1]?.target).toEqual({ provider: 'OLLAMA', model: 'b' });
    expect(seen[1]?.candidates).toEqual([{ provider: 'OLLAMA', model: 'c' }]);
  });

  it('walks the whole list once, then reports the last limited run as it ended', async () => {
    const { seen, attempt } = scripted([
      () => outcome(true),
      () => outcome(true),
      // The last model has no fallback left, so the attempt is not swallowed.
      () => ({ ...outcome(false), report: { outcome: 'failed', toolCalls: 1 } }),
    ]);

    const result = await runWithFallbacks(config(), attempt);

    expect(seen.map((input) => input.target.model)).toEqual(['a', 'b', 'c']);
    expect(result.outcome).toBe('failed');
  });

  it('continues after a thrown rate limit, and rethrows any other error at once', async () => {
    const first = scripted([() => limited(), () => outcome(false)]);
    await expect(runWithFallbacks(config(), first.attempt)).resolves.toMatchObject({
      outcome: 'completed',
    });

    const other = new Error('boom');
    const second = scripted([() => other, () => outcome(false)]);
    await expect(runWithFallbacks(config(), second.attempt)).rejects.toBe(other);
    expect(second.seen).toHaveLength(1);
  });

  it('rethrows the rate limit when no fallback is left', async () => {
    const error = limited();
    const { seen, attempt } = scripted([() => error]);

    await expect(runWithFallbacks(config({ fallbacks: [] }), attempt)).rejects.toBe(error);
    expect(seen).toHaveLength(1);
  });

  it('does not continue once the caller cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = limited();
    const { seen, attempt } = scripted([() => error]);

    await expect(runWithFallbacks(config({ signal: controller.signal }), attempt)).rejects.toBe(
      error,
    );
    expect(seen).toHaveLength(1);
  });

  it('does not continue when the deadline has no time left', async () => {
    let time = 0;
    const error = limited();
    const { seen, attempt } = scripted([
      () => {
        time = 200_000;
        return error;
      },
    ]);

    await expect(runWithFallbacks(config({ now: () => time }), attempt)).rejects.toBe(error);
    expect(seen).toHaveLength(1);
  });

  it('hands each attempt the time that is left', async () => {
    let time = 0;
    const { seen, attempt } = scripted([
      () => {
        time = 40_000;
        return outcome(true);
      },
      () => outcome(false),
    ]);

    await runWithFallbacks(config({ now: () => time }), attempt);

    expect(seen[0]?.timeLeftMs()).toBe(60_000);
    expect(seen[1]?.timeLeftMs()).toBe(60_000);
  });
});

describe('the model list helpers', () => {
  it('drops the primary and repeats, so each model is tried once', () => {
    expect(
      resolvedFallbacks(primary, [
        { model: 'a' },
        { provider: 'GEMINI', model: 'a' },
        { model: 'b' },
        { provider: 'OLLAMA', model: 'b' },
      ]),
    ).toEqual([
      { provider: 'GEMINI', model: 'a' },
      { provider: 'OLLAMA', model: 'b' },
    ]);
  });

  it('keeps what is listed after the model in use', () => {
    const list = [
      { provider: 'OLLAMA', model: 'b' },
      { provider: 'OLLAMA', model: 'c' },
    ];
    expect(fallbacksAfter({ provider: 'OLLAMA', model: 'b' }, list)).toEqual([list[1]]);
    expect(fallbacksAfter({ provider: 'OLLAMA', model: 'a' }, list)).toEqual(list);
  });

  it.each([
    ['run.failed', { reason: 'HTTP 429 Too Many Requests' }, true],
    ['run.failed', { message: 'provider rate-limited the request' }, true],
    ['run.failed', { message: 'rate limit exceeded' }, true],
    ['run.failed', { message: 'tool exploded' }, false],
    ['run.completed', { message: 'rate limit' }, false],
  ])('reads %s %j as limited: %s', (type, payload, expected) => {
    expect(isRateLimitedTerminal({ type, payload })).toBe(expected);
  });
});
