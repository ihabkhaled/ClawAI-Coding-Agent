import { describe, expect, it } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import {
  classifyBackendFailure,
  retryClassFor,
  withBackendRetries,
} from '../../src/backend/backend-retry';
import { parseRetryAfter } from '../../src/core/retry-after';
import {
  backoffMs,
  classifyHttpFailure,
  networkFailureCode,
  retryBudgetSpent,
} from '../../src/core/retry-classifier';

const http = (status: number, message = 'boom', retryAfterMs?: number): BackendRequestError =>
  new BackendRequestError(message, status, true, { retryAfterMs });

interface Harness {
  readonly waits: number[];
  readonly tuning: {
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    now: () => number;
  };
}

function harness(): Harness {
  const waits: number[] = [];
  let clock = 0;
  return {
    waits,
    tuning: {
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      random: () => 0.5,
      now: () => clock,
    },
  };
}

function failingThen<T>(
  errors: readonly Error[],
  value: T,
): { run: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    run: () => {
      const error = errors[calls];
      calls += 1;
      return error === undefined ? Promise.resolve(value) : Promise.reject(error);
    },
  };
}

describe('pure retry classifier', () => {
  it('retries the transient statuses and a 500 that says unavailable', () => {
    for (const status of [408, 429, 502, 503, 504]) {
      expect(classifyHttpFailure({ status, detail: '' }).retry).toBe(true);
    }
    expect(classifyHttpFailure({ status: 500, detail: 'state Unavailable' }).retry).toBe(true);
    expect(classifyHttpFailure({ status: 400, detail: 'provider is busy' }).retry).toBe(true);
  });

  it('never retries an answer', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      expect(classifyHttpFailure({ status, detail: 'nope' }).retry).toBe(false);
    }
  });

  it('keeps Retry-After on the verdict', () => {
    expect(classifyHttpFailure({ status: 429, detail: '', retryAfterMs: 2_000 })).toEqual({
      retry: true,
      status: 429,
      retryAfterMs: 2_000,
    });
  });

  it('finds a network code through the cause chain', () => {
    const inner = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(networkFailureCode(new Error('fetch failed', { cause: inner }))).toBe('ECONNRESET');
    expect(networkFailureCode(new Error('fetch failed'))).toBe('NETWORK');
    expect(networkFailureCode(new Error('bad input'))).toBeUndefined();
    expect(networkFailureCode('text')).toBeUndefined();
  });

  it('grows the backoff, jitters it and caps it', () => {
    expect(backoffMs(1, () => 0.5)).toBe(1_000);
    expect(backoffMs(3, () => 0.5)).toBe(4_000);
    expect(backoffMs(1, () => 0)).toBe(750);
    expect(backoffMs(10, () => 1)).toBe(15_000);
  });

  it('spends the budget on attempts or on time', () => {
    const base = { failures: 1, elapsedMs: 0, waitMs: 1_000, maxAttempts: 3, budgetMs: 10_000 };
    expect(retryBudgetSpent(base)).toBe(false);
    expect(retryBudgetSpent({ ...base, failures: 3 })).toBe(true);
    expect(retryBudgetSpent({ ...base, elapsedMs: 9_500 })).toBe(true);
  });

  it('reads Retry-After as seconds or a date and caps it', () => {
    expect(parseRetryAfter('3')).toBe(3_000);
    expect(parseRetryAfter('9999')).toBe(30_000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4_000)).toBe(6_000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('backend failure classification', () => {
  it('retries a dropped connection that kept its code, not one that did not', () => {
    const dropped = new BackendRequestError('x', 0, true, { code: 'ECONNRESET' });
    expect(classifyBackendFailure(dropped)).toEqual({ retry: true, code: 'ECONNRESET' });
    expect(classifyBackendFailure(new BackendRequestError('timed out', 0, true)).retry).toBe(false);
  });

  it('does not retry a non-backend error', () => {
    expect(classifyBackendFailure(new Error('schema broke')).retry).toBe(false);
  });
});

describe('retryClassFor', () => {
  it('allows an opted-in GET and a keyed command, and nothing else', () => {
    expect(retryClassFor('GET', 'read', undefined)).toBe('read');
    expect(retryClassFor('GET', undefined, undefined)).toBeUndefined();
    expect(retryClassFor('GET', 'command', undefined)).toBeUndefined();
    expect(retryClassFor('POST', 'command', { idempotencyKey: 'k' })).toBe('command');
    expect(retryClassFor('POST', 'start', { idempotencyKey: 'k' })).toBe('start');
    expect(retryClassFor('POST', 'start', {})).toBeUndefined();
    expect(retryClassFor('GET', 'start', undefined)).toBeUndefined();
    expect(retryClassFor('POST', 'command', { generation: 'g' })).toBeUndefined();
    expect(retryClassFor('POST', 'command', { idempotencyKey: '' })).toBeUndefined();
    expect(retryClassFor('POST', undefined, { idempotencyKey: 'k' })).toBeUndefined();
    expect(retryClassFor('PATCH', 'command', { idempotencyKey: 'k' })).toBeUndefined();
    expect(retryClassFor('DELETE', 'command', { idempotencyKey: 'k' })).toBeUndefined();
  });
});

describe('withBackendRetries', () => {
  it('429 then 200 succeeds and waits the Retry-After', async () => {
    const h = harness();
    const call = failingThen([http(429, 'slow down', 2_000)], 'ok');
    await expect(withBackendRetries('command', call.run, undefined, h.tuning)).resolves.toBe('ok');
    expect(h.waits).toEqual([2_000]);
    expect(call.calls()).toBe(2);
  });

  it('503 three times then success, with growing backoff', async () => {
    const h = harness();
    const call = failingThen([http(503), http(503), http(503)], 'ok');
    await expect(withBackendRetries('command', call.run, undefined, h.tuning)).resolves.toBe('ok');
    expect(h.waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('retries a network reset', async () => {
    const h = harness();
    const reset = new BackendRequestError('down', 0, true, { code: 'ECONNRESET' });
    const call = failingThen([reset], 'ok');
    await expect(withBackendRetries('read', call.run, undefined, h.tuning)).resolves.toBe('ok');
  });

  it('rethrows the last error when the attempts are spent', async () => {
    const h = harness();
    const last = http(503, 'last');
    const call = failingThen([http(503), http(503), last, http(503, 'never')], 'ok');
    await expect(withBackendRetries('read', call.run, undefined, h.tuning)).rejects.toBe(last);
    expect(call.calls()).toBe(3);
  });

  it('rethrows when the time budget would be broken', async () => {
    const h = harness();
    const error = http(503, 'slow', 30_000);
    const call = failingThen([error, error, error, error, error], 'ok');
    await expect(
      withBackendRetries('command', call.run, undefined, { ...h.tuning, budgetMs: 50_000 }),
    ).rejects.toBe(error);
    expect(call.calls()).toBe(2);
  });

  it('gives up on four 429s in a row', async () => {
    const h = harness();
    const call = failingThen([http(429), http(429), http(429), http(429)], 'ok');
    await expect(
      withBackendRetries('command', call.run, undefined, h.tuning),
    ).rejects.toBeInstanceOf(BackendRequestError);
    expect(call.calls()).toBe(4);
  });

  it('does not retry 401, 403 or 404', async () => {
    for (const status of [401, 403, 404]) {
      const h = harness();
      const call = failingThen([http(status), http(status)], 'ok');
      await expect(
        withBackendRetries('command', call.run, undefined, h.tuning),
      ).rejects.toMatchObject({ status });
      expect(call.calls()).toBe(1);
    }
  });

  it('stops at once when the signal aborts during the wait', async () => {
    const controller = new AbortController();
    const call = failingThen([http(503), http(503)], 'ok');
    const tuning = {
      sleep: (): Promise<void> => {
        controller.abort(new Error('stopped'));
        return Promise.resolve();
      },
    };
    await expect(
      withBackendRetries('command', call.run, controller.signal, tuning),
    ).rejects.toThrow('stopped');
    expect(call.calls()).toBe(1);
  });

  it('does not wait at all when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness();
    const call = failingThen([http(503)], 'ok');
    await expect(
      withBackendRetries('command', call.run, controller.signal, h.tuning),
    ).rejects.toBeInstanceOf(BackendRequestError);
    expect(h.waits).toEqual([]);
  });
});
