import { describe, expect, it } from 'vitest';

import {
  addTokenReceipts,
  cachedShare,
  estimateTokens,
  reconcileTokenReceipt,
} from '../../src/core/token-telemetry';

import type { TokenReceipt } from '../../src/core/token-telemetry';

function receipt(overrides: Partial<TokenReceipt> = {}): TokenReceipt {
  return { input: 100, output: 20, cached: 0, source: 'reported', total: 120, ...overrides };
}

describe('reconcileTokenReceipt', () => {
  it('records the cached tokens a provider reported', () => {
    const reconciled = reconcileTokenReceipt(estimateTokens('prompt'), {
      input: 44_000,
      output: 500,
      cached: 40_000,
    });

    expect(reconciled.cached).toBe(40_000);
  });

  it('keeps cached inside input, since it is a part of it and not an addition', () => {
    const reconciled = reconcileTokenReceipt(estimateTokens('prompt'), {
      input: 44_000,
      output: 500,
      cached: 40_000,
    });

    expect(reconciled.total).toBe(44_500);
    expect(reconciled.cached).toBeLessThanOrEqual(reconciled.input);
  });

  it('clamps a provider claiming more cached tokens than prompt tokens', () => {
    const reconciled = reconcileTokenReceipt(estimateTokens('prompt'), {
      input: 1_000,
      output: 10,
      cached: 9_999,
    });

    expect(reconciled.cached).toBe(1_000);
  });

  it('reports nothing cached when the provider said nothing', () => {
    expect(reconcileTokenReceipt(estimateTokens('prompt'), { input: 10, output: 2 }).cached).toBe(
      0,
    );
  });

  it('treats an unusable cached count as none rather than as a number', () => {
    expect(
      reconcileTokenReceipt(estimateTokens('prompt'), {
        input: 10,
        output: 2,
        cached: Number.NaN,
      }).cached,
    ).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('never claims a cache hit it could not have observed', () => {
    expect(estimateTokens('some prompt').cached).toBe(0);
  });
});

describe('addTokenReceipts', () => {
  it('adds cached counts across requests', () => {
    const combined = addTokenReceipts(
      receipt({ input: 100, cached: 80 }),
      receipt({ input: 200, cached: 150 }),
    );

    expect(combined.cached).toBe(230);
    expect(combined.input).toBe(300);
  });

  it('keeps the total counting cached tokens, which still occupy the window', () => {
    const combined = addTokenReceipts(
      receipt({ input: 100, output: 0, cached: 100, total: 100 }),
      receipt({ input: 0, output: 50, cached: 0, total: 50 }),
    );

    expect(combined.total).toBe(150);
  });
});

describe('cachedShare', () => {
  it('reports the share of the prompt that came from cache', () => {
    expect(cachedShare(receipt({ input: 44_000, cached: 40_000 }))).toBe(91);
  });

  it('reports zero rather than dividing by nothing', () => {
    expect(cachedShare(receipt({ input: 0, cached: 0 }))).toBe(0);
  });

  it('reports zero when nothing was cached', () => {
    expect(cachedShare(receipt({ input: 1_000, cached: 0 }))).toBe(0);
  });
});
