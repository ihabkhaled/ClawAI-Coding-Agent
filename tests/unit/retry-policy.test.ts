import { describe, expect, it } from 'vitest';

import { parseRetryAfter } from '../../src/headless/retry-after';
import {
  abortableSleep,
  backoffMs,
  classifyFailure,
  Retrier,
  withRetries,
} from '../../src/headless/retry-policy';
import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { isRunLostError } from '../../src/sdk/run-lost';

import type { RetryNotice } from '../../src/headless/retry-policy.types';

const http = (status: number, detail = ''): RuntimeHttpError =>
  new RuntimeHttpError('/x', status, detail);

const networkError = (code: string): Error => {
  const wrapped = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code }) });
  return wrapped;
};

function clock() {
  let time = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    tuning: {
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

describe('classifyFailure', () => {
  it.each([408, 429, 502, 503, 504])('retries HTTP %i', (status) => {
    expect(classifyFailure(http(status))).toMatchObject({ retry: true, status });
  });

  it.each([400, 401, 403, 404, 409, 422, 501])('never retries HTTP %i', (status) => {
    expect(classifyFailure(http(status)).retry).toBe(false);
  });

  it('retries a 500 only when its body says the state is unavailable', () => {
    expect(classifyFailure(http(500, '{"message":"Runtime state is unavailable"}')).retry).toBe(
      true,
    );
    expect(classifyFailure(http(500, '{"message":"boom"}')).retry).toBe(false);
  });

  it.each(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'])(
    'retries a fetch failure caused by %s and names the code',
    (code) => {
      expect(classifyFailure(networkError(code))).toEqual({ retry: true, code });
    },
  );

  it.each(['socket hang up', 'fetch failed', 'terminated', 'other side closed'])(
    'retries the bare message "%s"',
    (message) => {
      expect(classifyFailure(new Error(message)).retry).toBe(true);
    },
  );

  it('does not retry a parse error, a plain failure or a non-error', () => {
    expect(classifyFailure(new SyntaxError('Unexpected token')).retry).toBe(false);
    expect(classifyFailure(new Error('Thread creation returned no identifier')).retry).toBe(false);
    expect(classifyFailure('nope').retry).toBe(false);
  });

  it('carries the server Retry-After', () => {
    expect(classifyFailure(new RuntimeHttpError('/x', 429, '', 2_000))).toEqual({
      retry: true,
      status: 429,
      retryAfterMs: 2_000,
    });
  });
});

describe('backoff', () => {
  it('starts at 1s, doubles, and stops growing at 15s', () => {
    const waits = [1, 2, 3, 4, 5, 6, 12].map((attempt) => backoffMs(attempt, () => 0.5));
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
  });

  it('spreads a wait by up to a quarter either way', () => {
    expect(backoffMs(1, () => 0)).toBe(750);
    expect(backoffMs(1, () => 1)).toBe(1_250);
  });

  it('reads Retry-After as seconds or a date, capped at 30s', () => {
    expect(parseRetryAfter('2')).toBe(2_000);
    expect(parseRetryAfter('3600')).toBe(30_000);
    expect(
      parseRetryAfter('Wed, 21 Oct 2015 07:28:05 GMT', Date.parse('2015-10-21T07:28:03Z')),
    ).toBe(2_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('withRetries', () => {
  it('waits, announces each retry, and returns the eventual answer', async () => {
    const { tuning, sleeps } = clock();
    const notices: RetryNotice[] = [];
    let calls = 0;
    const value = await withRetries({ ...tuning, onRetry: (n) => notices.push(n) }, () => {
      calls += 1;
      return calls < 4 ? Promise.reject(http(503)) : Promise.resolve('ok');
    });

    expect(value).toBe('ok');
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
    expect(notices).toEqual([
      { attempt: 1, waitMs: 1_000, status: 503 },
      { attempt: 2, waitMs: 2_000, status: 503 },
      { attempt: 3, waitMs: 4_000, status: 503 },
    ]);
  });

  it('gives up after 12 attempts with a plain message', async () => {
    const { tuning, sleeps } = clock();
    let calls = 0;
    const failure = await withRetries(tuning, () => {
      calls += 1;
      return Promise.reject(http(503, 'down'));
    }).catch((error: unknown) => error as Error);

    expect(calls).toBe(12);
    expect(sleeps).toHaveLength(11);
    expect(failure.name).toBe('RuntimeUnavailableError');
    expect(failure.message).toMatch(/stayed unavailable: gave up after 12 attempts/u);
    expect(failure.message).toContain('HTTP 503 down');
  });

  it('gives up when the next wait would pass the 5 minute budget', async () => {
    const { tuning, sleeps } = clock();
    const failure = await withRetries({ ...tuning, maxAttempts: 100 }, () =>
      Promise.reject(http(503)),
    ).catch((error: unknown) => error as Error);

    const waited = sleeps.reduce((sum, ms) => sum + ms, 0);
    expect(waited).toBeLessThanOrEqual(300_000);
    expect(waited).toBeGreaterThan(280_000);
    expect(failure.message).toMatch(/gave up after/u);
  });

  it('throws the original error at once when it is not transient', async () => {
    const { tuning, sleeps } = clock();
    const original = http(400, 'bad');
    let calls = 0;
    const failure = await withRetries(tuning, () => {
      calls += 1;
      return Promise.reject(original);
    }).catch((error: unknown) => error);

    expect(failure).toBe(original);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('honours Retry-After over the backoff', async () => {
    const { tuning, sleeps } = clock();
    let calls = 0;
    await withRetries(tuning, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new RuntimeHttpError('/x', 429, '', 7_000))
        : Promise.resolve();
    });
    expect(sleeps).toEqual([7_000]);
  });

  it('starts again after reset, so a stream that made progress keeps its allowance', async () => {
    const { tuning, sleeps } = clock();
    const retrier = new Retrier({ ...tuning, maxAttempts: 2 });
    await retrier.backoff(http(503));
    retrier.reset();
    await retrier.backoff(http(503));
    expect(sleeps).toEqual([1_000, 1_000]);
  });
});

describe('abort', () => {
  it('ends a sleep at once when the signal aborts', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort();
    await sleeping;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('stops retrying and throws the failure when aborted during a wait', async () => {
    const controller = new AbortController();
    const original = http(503);
    let calls = 0;
    const failure = await withRetries(
      {
        signal: controller.signal,
        sleep: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
      () => {
        calls += 1;
        return Promise.reject(original);
      },
    ).catch((error: unknown) => error);

    expect(failure).toBe(original);
    expect(calls).toBe(1);
  });
});

describe('isRunLostError', () => {
  it('reads an unknown run, a terminal run and a stale claim as lost', () => {
    expect(isRunLostError(http(404, '{"code":"RUNTIME_RUN_NOT_FOUND"}'))).toBe(true);
    expect(isRunLostError(http(409, 'Runtime transition was denied: RUN_TERMINAL'))).toBe(true);
    expect(isRunLostError(http(409, 'Runtime transition was denied: STALE_CLAIM'))).toBe(true);
  });

  it('does not read a missing thread, a spent budget or a bad request as lost', () => {
    expect(isRunLostError(http(404, 'ChatThread not found'))).toBe(false);
    expect(
      isRunLostError(
        http(409, '{"code":"RUNTIME_BUDGET_EXHAUSTED","message":"allowed tool calls"}'),
      ),
    ).toBe(false);
    expect(isRunLostError(http(400, 'RUNTIME_RUN_NOT_FOUND'))).toBe(false);
    expect(isRunLostError(new Error('RUNTIME_RUN_NOT_FOUND'))).toBe(false);
  });
});
