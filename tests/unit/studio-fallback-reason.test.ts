import { describe, expect, it } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import { executeWithModelFallback } from '../../src/services/runtime-studio-fallback';
import { fallbackReasonFor } from '../../src/services/runtime-studio-fallback-notice';

import type {
  ModelFallbackInfo,
  RuntimeStudioInput,
} from '../../src/services/runtime-studio.types';

function run(message: string, status?: number): Promise<ModelFallbackInfo[]> {
  const seen: ModelFallbackInfo[] = [];
  const input = {
    requestId: 'r',
    prompt: 'p',
    provider: 'A',
    model: 'a',
    signal: new AbortController().signal,
    onEvent: () => undefined,
    onModelFallback: (info: ModelFallbackInfo) => seen.push(info),
  } as unknown as RuntimeStudioInput;
  let calls = 0;
  return executeWithModelFallback(
    { input, configuration: () => ({ fallbackModels: ['B/b'] }) },
    () => {
      calls += 1;
      if (calls === 1) throw new BackendRequestError(message, status ?? 402, false);
      return Promise.resolve();
    },
  ).then(() => seen);
}

describe('model fallback reason', () => {
  it('classifies spent credit and rate limits', () => {
    expect(fallbackReasonFor('PAYG_CREDIT_EXHAUSTED')).toBe('credit');
    expect(fallbackReasonFor('PAYG_FREE_ALLOWANCE_EXHAUSTED')).toBe('credit');
    expect(fallbackReasonFor('HTTP 429 too many requests')).toBe('rate-limit');
    expect(fallbackReasonFor('')).toBe('rate-limit');
    expect(fallbackReasonFor('CLOUD_PROVIDER_UNAVAILABLE')).toBe('rate-limit');
    expect(fallbackReasonFor('PROVIDER_CREDIT_EXHAUSTED')).toBe('credit');
  });

  it('reports credit when the refusal names a credit code', async () => {
    const seen = await run('PAYG_CREDIT_EXHAUSTED');
    expect(seen).toEqual([{ from: 'A/a', to: 'B/b', reason: 'credit' }]);
  });

  it('reports a rate limit on a 429', async () => {
    const seen = await run('slow down', 429);
    expect(seen).toEqual([{ from: 'A/a', to: 'B/b', reason: 'rate-limit' }]);
  });
});
