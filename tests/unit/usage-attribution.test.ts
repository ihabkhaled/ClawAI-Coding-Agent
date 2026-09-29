import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: string[]) =>
      message.replace(/\{(\d+)\}/gu, (_match: string, index: string) => args[Number(index)] ?? ''),
  },
}));

import {
  attributionModelLabel,
  attributionSourceLabel,
  totalOnlyTokens,
  UsageAttributionLedger,
} from '../../src/core/usage-attribution';
import {
  USAGE_ATTRIBUTION_MAX_DIMENSIONS,
  USAGE_ATTRIBUTION_OVERFLOW,
} from '../../src/core/usage-attribution.constants';
import { usageAttributionLines } from '../../src/services/show-usage-attribution';

function tokens(input: number, output: number, cached = 0) {
  return { input, output, cached, total: input + output };
}

describe('UsageAttributionLedger', () => {
  it('splits a session by what spent it and by model, largest first', () => {
    const ledger = new UsageAttributionLedger();
    ledger.record({
      source: { kind: 'chat', name: 'chat' },
      model: 'openai/gpt',
      tokens: tokens(10, 5),
    });
    ledger.record({
      source: { kind: 'workflow', name: 'review' },
      model: 'openai/gpt',
      tokens: tokens(100, 50, 40),
    });
    ledger.record({
      source: { kind: 'subagent', name: 'tester' },
      model: 'auto',
      tokens: totalOnlyTokens(30),
    });

    const summary = ledger.summary();
    expect(summary.turns).toBe(3);
    expect(summary.total).toBe(195);
    expect(summary.bySource.map((line) => line.dimension)).toEqual([
      'workflow: review',
      'subagent: tester',
      'chat',
    ]);
    expect(summary.byModel[0]).toEqual({
      dimension: 'openai/gpt',
      turns: 2,
      input: 110,
      output: 55,
      cached: 40,
      total: 165,
    });

    ledger.clear();
    expect(ledger.summary()).toEqual({ bySource: [], byModel: [], turns: 0, total: 0 });
  });

  it('folds sources past the cap into one line instead of growing without bound', () => {
    const ledger = new UsageAttributionLedger();
    for (let index = 0; index <= USAGE_ATTRIBUTION_MAX_DIMENSIONS + 3; index += 1) {
      ledger.record({
        source: { kind: 'subagent', name: `agent-${String(index)}` },
        model: 'auto',
        tokens: totalOnlyTokens(1),
      });
    }
    const summary = ledger.summary();
    expect(summary.bySource).toHaveLength(USAGE_ATTRIBUTION_MAX_DIMENSIONS + 1);
    const overflow = summary.bySource.find((line) => line.dimension === USAGE_ATTRIBUTION_OVERFLOW);
    expect(overflow?.turns).toBe(4);
  });

  it('treats non-finite and negative counts as zero', () => {
    const ledger = new UsageAttributionLedger();
    ledger.record({
      source: { kind: 'agent', name: 'agent' },
      model: 'auto',
      tokens: { input: Number.NaN, output: -4, cached: 0, total: Number.POSITIVE_INFINITY },
    });
    expect(ledger.summary().total).toBe(0);
    expect(totalOnlyTokens(-3).total).toBe(0);
  });
});

describe('attribution labels', () => {
  it('names the source without repeating the kind', () => {
    expect(attributionSourceLabel({ kind: 'chat', name: 'chat' })).toBe('chat');
    expect(attributionSourceLabel({ kind: 'workflow', name: 'explain' })).toBe('workflow: explain');
  });

  it('names the model, falling back to auto when the router chose', () => {
    expect(attributionModelLabel('openai', 'gpt')).toBe('openai/gpt');
    expect(attributionModelLabel(undefined, 'gpt')).toBe('gpt');
    expect(attributionModelLabel('AUTO', 'gpt')).toBe('gpt');
    expect(attributionModelLabel('', 'gpt')).toBe('gpt');
    expect(attributionModelLabel('openai', 'AUTO')).toBe('auto');
    expect(attributionModelLabel(undefined, undefined)).toBe('auto');
    expect(attributionModelLabel('openai', '')).toBe('auto');
  });
});

describe('usageAttributionLines', () => {
  it('says so when nothing has been spent yet', () => {
    const lines = usageAttributionLines(new UsageAttributionLedger().summary());
    expect(lines.join('\n')).toContain('Nothing has used tokens in this session yet.');
  });

  it('renders both tables for a session that spent tokens', () => {
    const ledger = new UsageAttributionLedger();
    ledger.record({
      source: { kind: 'chat', name: 'chat' },
      model: 'openai/gpt',
      tokens: tokens(3, 2, 1),
    });
    const text = usageAttributionLines(ledger.summary()).join('\n');
    expect(text).toContain('5 tokens over 1 turns.');
    expect(text).toContain('### By source');
    expect(text).toContain('### By model');
    expect(text).toContain('| chat | 1 | 3 | 2 | 1 | 5 |');
    expect(text).toContain('| openai/gpt | 1 | 3 | 2 | 1 | 5 |');
  });
});
