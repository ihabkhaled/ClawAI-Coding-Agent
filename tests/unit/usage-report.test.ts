import { describe, expect, it } from 'vitest';

import { buildUsageReport } from '../../src/core/usage-report';

import type { Usage } from '../../src/backend/contracts';

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    day: { used: 250, limit: 1_000, remaining: 750 },
    week: { used: 900, limit: null, remaining: null },
    month: { used: 4_000, limit: 10_000, remaining: 6_000 },
    features: [],
    ...overrides,
  } as Usage;
}

describe('buildUsageReport', () => {
  it('reports all three windows in order', () => {
    expect(buildUsageReport(usage()).windows.map((line) => line.window)).toEqual([
      'day',
      'week',
      'month',
    ]);
  });

  it('computes the percentage against a real limit', () => {
    expect(buildUsageReport(usage()).windows[0]?.percentUsed).toBe(25);
  });

  it('reports no percentage for an unlimited window rather than zero or a hundred', () => {
    expect(buildUsageReport(usage()).windows[1]?.percentUsed).toBeNull();
  });

  it('reports no percentage for a zero limit rather than dividing by it', () => {
    const zeroed = usage({ day: { used: 5, limit: 0, remaining: 0 } } as Partial<Usage>);

    expect(buildUsageReport(zeroed).windows[0]?.percentUsed).toBeNull();
  });

  it('caps a window that overran its limit at 100', () => {
    const over = usage({ day: { used: 2_000, limit: 1_000, remaining: 0 } } as Partial<Usage>);

    expect(buildUsageReport(over).windows[0]?.percentUsed).toBe(100);
  });

  it('keeps features that carry a limit or have been used', () => {
    const withFeatures = usage({
      features: [
        { feature: 'compare', allowed: true, limit: 10, used: 0, remaining: 10, window: 'day' },
        { feature: 'chat', allowed: true, limit: null, used: 42, remaining: null, window: null },
      ],
    });

    expect(buildUsageReport(withFeatures).features.map((line) => line.feature)).toEqual([
      'compare',
      'chat',
    ]);
  });

  it('drops the unlimited, unused features that would bury the rest', () => {
    const noisy = usage({
      features: [
        { feature: 'quiet', allowed: true, limit: null, used: 0, remaining: null, window: null },
        { feature: 'loud', allowed: false, limit: 5, used: 5, remaining: 0, window: 'day' },
      ],
    });

    expect(buildUsageReport(noisy).features.map((line) => line.feature)).toEqual(['loud']);
  });
});
