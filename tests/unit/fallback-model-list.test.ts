import { describe, expect, it } from 'vitest';

import { parseFallbackModels } from '../../src/core/fallback-model-list';
import { parseHeadlessArgs } from '../../src/headless/headless-args';

describe('parseFallbackModels', () => {
  it('reads PROVIDER/model and bare models, trimming and dropping blanks', () => {
    expect(parseFallbackModels(['gemini/flash, kimi-k3', '', '  '])).toEqual([
      { provider: 'GEMINI', model: 'flash' },
      { provider: undefined, model: 'kimi-k3' },
    ]);
  });

  it('is empty for no setting', () => {
    expect(parseFallbackModels(undefined)).toEqual([]);
    expect(parseFallbackModels([])).toEqual([]);
  });
});

describe('--fallback-model', () => {
  const parse = (argv: string[], env: Record<string, string> = {}) =>
    parseHeadlessArgs(['-p', 'x', ...argv], env, '/work');

  it('is repeatable and keeps the order', () => {
    const parsed = parse(['--fallback-model', 'a', '--fallback-model', 'GEMINI/b,c']);
    expect(parsed).toMatchObject({
      kind: 'run',
      invocation: {
        fallbackModels: [
          { provider: undefined, model: 'a' },
          { provider: 'GEMINI', model: 'b' },
          { provider: undefined, model: 'c' },
        ],
      },
    });
  });

  it('falls back to CLAW_FALLBACK_MODELS, and the flag wins', () => {
    expect(parse([], { CLAW_FALLBACK_MODELS: 'env-m' })).toMatchObject({
      invocation: { fallbackModels: [{ model: 'env-m' }] },
    });
    expect(parse(['--fallback-model', 'flag-m'], { CLAW_FALLBACK_MODELS: 'env-m' })).toMatchObject({
      invocation: { fallbackModels: [{ model: 'flag-m' }] },
    });
  });

  it('is empty by default and needs a value', () => {
    expect(parse([])).toMatchObject({ kind: 'run' });
    expect(parse([])).not.toHaveProperty('invocation.fallbackModels');
    expect(parse(['--fallback-model'])).toEqual({
      kind: 'usage',
      message: '--fallback-model needs a value.',
    });
  });
});
