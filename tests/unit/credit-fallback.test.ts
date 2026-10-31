import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '../../src/backend/backend-errors';
import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { runWithFallbacks } from '../../src/sdk/agent-run-fallback';
import { isRateLimitFailure, startWithModelFallback } from '../../src/sdk/model-fallback';
import { executeWithModelFallback } from '../../src/services/runtime-studio-fallback';

import type { AttemptInput, AttemptOutcome } from '../../src/sdk/agent-run-fallback';
import type { ResolvedModel } from '../../src/sdk/model-fallback';
import type { RuntimeStudioInput } from '../../src/services/runtime-studio.types';

const primary: ResolvedModel = { provider: 'OLLAMA', model: 'a' };

const CREDIT_CODES = [
  'PAYG_CREDIT_EXHAUSTED',
  'PAYG_FREE_ALLOWANCE_EXHAUSTED',
  'PAYG_MODEL_NOT_IN_FREE_ALLOWANCE',
  'PAYG_PROMPT_TOO_EXPENSIVE',
] as const;

const creditError = (code = 'PAYG_CREDIT_EXHAUSTED'): RuntimeHttpError =>
  new RuntimeHttpError('/runs', 402, JSON.stringify({ code }), undefined, code);

describe('startWithModelFallback on a spent-credit refusal', () => {
  it.each(CREDIT_CODES)(
    'moves from the primary to the next model on %s and says so',
    async (code) => {
      const started: string[] = [];
      const onFallback = vi.fn();
      const start = (choice: ResolvedModel): Promise<string> => {
        started.push(choice.model);
        return choice.model === 'a' ? Promise.reject(creditError(code)) : Promise.resolve('ok');
      };

      await expect(
        startWithModelFallback(primary, [{ model: 'b' }], start, onFallback),
      ).resolves.toBe('ok');

      expect(started).toEqual(['a', 'b']);
      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledWith({ from: 'OLLAMA/a', to: 'OLLAMA/b' });
    },
  );

  it('rethrows the credit error when there is no fallback', async () => {
    const error = creditError();
    const start = vi.fn((_: ResolvedModel) => Promise.reject(error));
    const onFallback = vi.fn();

    await expect(startWithModelFallback(primary, undefined, start, onFallback)).rejects.toBe(error);
    await expect(startWithModelFallback(primary, [], start, onFallback)).rejects.toBe(error);

    expect(start).toHaveBeenCalledTimes(2);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('does not retry a non-credit 500 on a fallback', async () => {
    const error = new RuntimeHttpError('/runs', 500, 'boom');
    const start = vi.fn((_: ResolvedModel) => Promise.reject(error));
    const onFallback = vi.fn();

    await expect(startWithModelFallback(primary, [{ model: 'b' }], start, onFallback)).rejects.toBe(
      error,
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('does not retry a plain Error that merely names a credit code', async () => {
    const error = new Error('PAYG_CREDIT_EXHAUSTED');
    const start = vi.fn((_: ResolvedModel) => Promise.reject(error));

    await expect(startWithModelFallback(primary, [{ model: 'b' }], start)).rejects.toBe(error);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('tries each candidate once, then throws the last credit error', async () => {
    const last = creditError('PAYG_FREE_ALLOWANCE_EXHAUSTED');
    const started: string[] = [];
    const start = (choice: ResolvedModel): Promise<string> => {
      started.push(choice.model);
      return Promise.reject(choice.model === 'c' ? last : creditError());
    };

    await expect(
      // Repeats of the primary and of an earlier fallback are dropped.
      startWithModelFallback(
        primary,
        [{ model: 'b' }, { model: 'a' }, { model: 'b' }, { model: 'c' }],
        start,
      ),
    ).rejects.toBe(last);

    expect(started).toEqual(['a', 'b', 'c']);
  });
});

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
    const result = script[seen.length - 1]?.(input);
    if (result === undefined) return Promise.reject(new Error('unscripted attempt'));
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  };
  return { seen, attempt };
}

const runConfig = (extra: Partial<Parameters<typeof runWithFallbacks>[0]> = {}) => ({
  primary,
  fallbacks: [{ model: 'b' }, { model: 'c' }],
  prompt: 'do it',
  deadlineMs: 100_000,
  now: () => 0,
  signal: undefined,
  onModelFallback: undefined,
  ...extra,
});

describe('runWithFallbacks on a mid-run credit failure', () => {
  it('continues on the next model with the continuation prompt', async () => {
    const { seen, attempt } = scripted([() => creditError(), () => outcome(false, 4)]);
    const onModelFallback = vi.fn();

    const result = await runWithFallbacks(runConfig({ onModelFallback }), attempt);

    expect(result).toMatchObject({ outcome: 'completed', toolCalls: 4 });
    expect(onModelFallback).toHaveBeenCalledWith({ from: 'OLLAMA/a', to: 'OLLAMA/b' });
    expect(seen.map((input) => input.target.model)).toEqual(['a', 'b']);
    expect(seen[1]?.prompt).toMatch(/Task:\ndo it$/su);
  });

  it('rethrows the credit error when no fallback is left', async () => {
    const error = creditError();
    const { seen, attempt } = scripted([() => error]);

    await expect(runWithFallbacks(runConfig({ fallbacks: [] }), attempt)).rejects.toBe(error);
    expect(seen).toHaveLength(1);
  });

  it('does not continue after a cancel, and rethrows a non-credit 500 at once', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = creditError();
    const cancelled = scripted([() => error]);
    await expect(
      runWithFallbacks(runConfig({ signal: controller.signal }), cancelled.attempt),
    ).rejects.toBe(error);
    expect(cancelled.seen).toHaveLength(1);

    const broken = new RuntimeHttpError('/runs', 500, 'boom');
    const other = scripted([() => broken, () => outcome(false)]);
    await expect(runWithFallbacks(runConfig(), other.attempt)).rejects.toBe(broken);
    expect(other.seen).toHaveLength(1);
  });
});

function studioSetup(
  fallbackModels: readonly string[] | undefined,
  signal = new AbortController().signal,
) {
  const switched: { from: string; to: string }[] = [];
  const input: RuntimeStudioInput = {
    prompt: 'do it',
    threadId: 'thread-1',
    requestId: 'request-1',
    provider: 'OLLAMA',
    model: 'a',
    signal,
    onEvent: () => undefined,
    onModelFallback: (info) => switched.push(info),
  };
  return { dependencies: { input, configuration: () => ({ fallbackModels }) }, switched };
}

type Deps = ReturnType<typeof studioSetup>['dependencies'];

describe('executeWithModelFallback on a spent-credit refusal', () => {
  it.each(CREDIT_CODES)('falls back on a 402 whose message carries %s', async (code) => {
    const { dependencies, switched } = studioSetup(['GEMINI/b']);
    const models: (string | undefined)[] = [];
    const attempt = (deps: Deps): Promise<void> => {
      models.push(deps.input.model);
      return models.length === 1
        ? Promise.reject(new BackendRequestError(`Refused (${code})`, 402, false))
        : Promise.resolve();
    };

    await executeWithModelFallback(dependencies, attempt);

    expect(models).toEqual(['a', 'b']);
    expect(switched).toEqual([{ from: 'OLLAMA/a', to: 'GEMINI/b', reason: 'credit' }]);
  });

  it('stops at once when the run was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { dependencies, switched } = studioSetup(['b'], controller.signal);
    const error = new BackendRequestError('No credit (PAYG_CREDIT_EXHAUSTED)', 402, false);
    const attempt = vi.fn((_: Deps) => Promise.reject(error));

    await expect(executeWithModelFallback(dependencies, attempt)).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(switched).toEqual([]);
  });

  it('does not fall back on a 500', async () => {
    const { dependencies, switched } = studioSetup(['b']);
    const error = new BackendRequestError('server broke', 500, true);
    const attempt = vi.fn((_: Deps) => Promise.reject(error));

    await expect(executeWithModelFallback(dependencies, attempt)).rejects.toBe(error);

    expect(attempt).toHaveBeenCalledTimes(1);
    expect(switched).toEqual([]);
  });

  it('throws the last credit error after each model was tried once', async () => {
    const { dependencies } = studioSetup(['b', 'a', 'b']);
    const models: (string | undefined)[] = [];
    const last = new BackendRequestError('PAYG_FREE_ALLOWANCE_EXHAUSTED', 402, false);
    const attempt = (deps: Deps): Promise<void> => {
      models.push(deps.input.model);
      return Promise.reject(
        models.length === 2 ? last : new BackendRequestError('PAYG_CREDIT_EXHAUSTED', 402, false),
      );
    };

    await expect(executeWithModelFallback(dependencies, attempt)).rejects.toBe(last);
    expect(models).toEqual(['a', 'b']);
  });
});

describe('RuntimeHttpError.fromResponse', () => {
  it('keeps the platform code when the body is cut short', () => {
    const body = JSON.stringify({ message: 'x'.repeat(400), code: 'PAYG_PROMPT_TOO_EXPENSIVE' });
    const error = RuntimeHttpError.fromResponse('/runs', new Response(null, { status: 402 }), body);
    expect(error.detail).toHaveLength(300);
    expect(error.code).toBe('PAYG_PROMPT_TOO_EXPENSIVE');
    expect(isRateLimitFailure(error)).toBe(true);
  });

  it('reads no code from text that is not a JSON object', () => {
    const error = RuntimeHttpError.fromResponse(
      '/runs',
      new Response(null, { status: 500 }),
      '<html>PAYG_CREDIT_EXHAUSTED</html>',
    );
    expect(error.code).toBeUndefined();
  });
});
