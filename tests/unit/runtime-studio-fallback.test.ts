import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import {
  executeWithModelFallback,
  isRateLimitedFailure,
  isStudioRateLimit,
  studioModelChain,
} from '../../src/services/runtime-studio-fallback';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { RuntimeStudioInput } from '../../src/services/runtime-studio.types';

const journal = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../fixtures/journals/runtime-completed-run.journal.json', import.meta.url),
    ),
    'utf8',
  ),
) as RuntimeEvent[];

function event(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  const first = journal[0];
  if (first === undefined) throw new Error('the captured journal fixture is empty');
  return { ...first, type, payload };
}

const limitedEnd = event('run.failed', { reason: { code: 'RATE_LIMITED', message: 'HTTP 429' } });

function setup(
  fallbackModels: readonly string[] | undefined,
  signal = new AbortController().signal,
) {
  const delivered: RuntimeEvent[] = [];
  const switched: { from: string; to: string }[] = [];
  const input: RuntimeStudioInput = {
    prompt: 'do it',
    threadId: 'thread-1',
    requestId: 'request-1',
    provider: 'OLLAMA',
    model: 'a',
    signal,
    onEvent: (e) => delivered.push(e),
    onModelFallback: (info) => switched.push(info),
  };
  const dependencies = {
    input,
    configuration: () => ({ fallbackModels }),
  };
  return { dependencies, delivered, switched };
}

type Deps = ReturnType<typeof setup>['dependencies'];

describe('executeWithModelFallback', () => {
  it('is a plain call, with the original input, when no fallback is configured', async () => {
    const { dependencies, switched } = setup(undefined);
    const attempt = vi.fn((_: Deps) => Promise.resolve());

    await executeWithModelFallback(dependencies, attempt);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0]?.[0].input).toMatchObject({ model: 'a', prompt: 'do it' });
    expect(switched).toEqual([]);
  });

  it('lets the original error through when no fallback is configured', async () => {
    const { dependencies } = setup([]);
    const error = new BackendRequestError('limited', 429, true);

    await expect(executeWithModelFallback(dependencies, () => Promise.reject(error))).rejects.toBe(
      error,
    );
  });

  it('moves to the next model when the start is refused with 429, and says so', async () => {
    const { dependencies, switched } = setup(['GEMINI/b']);
    const seen: RuntimeStudioInput[] = [];
    const attempt = (deps: Deps): Promise<void> => {
      seen.push(deps.input);
      return seen.length === 1
        ? Promise.reject(new BackendRequestError('limited', 429, true))
        : Promise.resolve();
    };

    await executeWithModelFallback(dependencies, attempt);

    expect(seen.map((input) => [input.provider, input.model])).toEqual([
      ['OLLAMA', 'a'],
      ['GEMINI', 'b'],
    ]);
    expect(seen[1]?.requestId).toBe('request-1.fallback1');
    expect(seen[1]?.prompt).toMatch(/rate limited.*Task:\ndo it$/su);
    expect(switched).toEqual([{ from: 'OLLAMA/a', to: 'GEMINI/b' }]);
  });

  it('holds back a rate-limited run.failed and continues on the fallback', async () => {
    const { dependencies, delivered, switched } = setup(['b']);
    const finish = event('run.completed');
    let calls = 0;
    const attempt = (deps: Deps): Promise<void> => {
      calls += 1;
      deps.input.onEvent(calls === 1 ? limitedEnd : finish);
      return Promise.resolve();
    };

    await executeWithModelFallback(dependencies, attempt);

    expect(calls).toBe(2);
    expect(delivered).toEqual([finish]);
    expect(switched).toEqual([{ from: 'OLLAMA/a', to: 'OLLAMA/b' }]);
  });

  it('shows the limit as the ending when the last model is limited too', async () => {
    const { dependencies, delivered } = setup(['b']);
    const attempt = (deps: Deps): Promise<void> => {
      deps.input.onEvent(limitedEnd);
      return Promise.resolve();
    };

    await executeWithModelFallback(dependencies, attempt);

    expect(delivered).toEqual([limitedEnd]);
  });

  it('tries each model once and throws the last 429', async () => {
    const { dependencies } = setup(['b', 'a', 'b']);
    const models: (string | undefined)[] = [];
    const last = new BackendRequestError('still limited', 429, true);
    const attempt = (deps: Deps): Promise<void> => {
      models.push(deps.input.model);
      return Promise.reject(models.length === 2 ? last : new BackendRequestError('x', 429, true));
    };

    await expect(executeWithModelFallback(dependencies, attempt)).rejects.toBe(last);
    expect(models).toEqual(['a', 'b']);
  });

  it('never falls back on another error, or after a cancel', async () => {
    const other = new BackendRequestError('bad', 400, false);
    const first = setup(['b']);
    const attempt = vi.fn((_: Deps) => Promise.reject(other));
    await expect(executeWithModelFallback(first.dependencies, attempt)).rejects.toBe(other);
    expect(attempt).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    const second = setup(['b'], controller.signal);
    const limited = new BackendRequestError('limited', 429, true);
    const again = vi.fn((_: Deps) => Promise.reject(limited));
    await expect(executeWithModelFallback(second.dependencies, again)).rejects.toBe(limited);
    expect(again).toHaveBeenCalledTimes(1);
  });
});

describe('the fallback helpers', () => {
  it('chains the primary then each fallback once, in the primary provider by default', () => {
    expect(
      studioModelChain({ provider: 'OLLAMA', model: 'a' }, ['a', 'b', 'GEMINI/c', 'b']),
    ).toEqual([
      { provider: 'OLLAMA', model: 'a' },
      { provider: 'OLLAMA', model: 'b' },
      { provider: 'GEMINI', model: 'c' },
    ]);
  });

  it('reads a 429 only from the extension client error', () => {
    expect(isStudioRateLimit(new BackendRequestError('x', 429, true))).toBe(true);
    expect(isStudioRateLimit(new BackendRequestError('x', 500, true))).toBe(false);
    expect(isStudioRateLimit(new Error('429'))).toBe(false);
  });

  it('reads a limited run.failed only', () => {
    expect(isRateLimitedFailure(limitedEnd)).toBe(true);
    expect(isRateLimitedFailure(event('run.failed', { reason: { code: 'TOOL' } }))).toBe(false);
    expect(isRateLimitedFailure(event('run.completed', { note: '429' }))).toBe(false);
  });
});
