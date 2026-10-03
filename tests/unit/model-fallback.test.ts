import { describe, expect, it, vi } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { RuntimeRateLimitedError } from '../../src/headless/runtime-rate-limited-error';
import { startWithModelFallback } from '../../src/sdk/model-fallback';

const primary = { provider: 'OLLAMA', model: 'kimi-k3' };
const limited = (): RuntimeRateLimitedError =>
  new RuntimeRateLimitedError(4, 9_000, new Error('429'));

describe('startWithModelFallback', () => {
  it('starts on the primary and never touches the fallbacks when it works', async () => {
    const start = vi.fn().mockResolvedValue('run');
    const onFallback = vi.fn();
    await expect(
      startWithModelFallback(primary, [{ model: 'b' }], start, onFallback),
    ).resolves.toBe('run');
    expect(start).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('moves to the next model when the primary stays rate limited, and says so', async () => {
    const start = vi.fn().mockRejectedValueOnce(limited()).mockResolvedValueOnce('run');
    const onFallback = vi.fn();
    await startWithModelFallback(
      primary,
      [{ provider: 'GEMINI', model: 'flash' }],
      start,
      onFallback,
    );
    expect(start).toHaveBeenLastCalledWith({ provider: 'GEMINI', model: 'flash' });
    expect(onFallback).toHaveBeenCalledWith({ from: 'OLLAMA/kimi-k3', to: 'GEMINI/flash' });
  });

  it('keeps the primary provider for a fallback that names only a model', async () => {
    const start = vi.fn().mockRejectedValueOnce(limited()).mockResolvedValueOnce('run');
    await startWithModelFallback(primary, [{ model: 'other' }], start);
    expect(start).toHaveBeenLastCalledWith({ provider: 'OLLAMA', model: 'other' });
  });

  it('treats a raw 429 the same as an exhausted one', async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new RuntimeHttpError('/x', 429, ''))
      .mockResolvedValueOnce('run');
    await expect(startWithModelFallback(primary, [{ model: 'b' }], start)).resolves.toBe('run');
  });

  it('tries each model once, then throws the last rate-limit error', async () => {
    const last = limited();
    const start = vi
      .fn()
      .mockRejectedValueOnce(limited())
      .mockRejectedValueOnce(limited())
      .mockRejectedValueOnce(last);
    await expect(
      startWithModelFallback(primary, [{ model: 'b' }, { model: 'c' }], start),
    ).rejects.toBe(last);
    expect(start).toHaveBeenCalledTimes(3);
  });

  it('fails at once, without a fallback, when there is none configured', async () => {
    const start = vi.fn().mockRejectedValue(limited());
    await expect(startWithModelFallback(primary, [], start)).rejects.toBeInstanceOf(
      RuntimeRateLimitedError,
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 500])('never falls back on HTTP %i', async (status) => {
    const start = vi.fn().mockRejectedValue(new RuntimeHttpError('/x', status, ''));
    await expect(startWithModelFallback(primary, [{ model: 'b' }], start)).rejects.toBeInstanceOf(
      RuntimeHttpError,
    );
    expect(start).toHaveBeenCalledTimes(1);
  });
});
