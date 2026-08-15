import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EFFORT_MODE,
  EFFORT_MODES,
  EFFORT_MODE_CONTRACTS,
  LEGACY_FIXED_BUDGET,
  effortBudget,
  normalizeEffortMode,
  type EffortMode,
} from '../../src/core/effort-mode';
import { runBudgetSchema, type RunBudget } from '../../src/core/runtime/runtime-tool-contracts';

const scaling = [
  'maxModelTurns',
  'maxToolCalls',
  'maxToolRounds',
  'maxRuntimeMs',
  'maxOutputBytes',
  'maxToolResultBytes',
] as const satisfies readonly (keyof RunBudget)[];

describe('effort modes', () => {
  it('produces a budget the transport schema accepts for every mode', () => {
    for (const mode of EFFORT_MODES) {
      expect(() => runBudgetSchema.parse(effortBudget(mode)), mode).not.toThrow();
    }
  });

  it('gives no two modes the same budget', () => {
    const seen = new Map<string, EffortMode>();
    for (const mode of EFFORT_MODES) {
      const key = JSON.stringify(effortBudget(mode));
      const clash = seen.get(key);
      expect(clash, `${mode} and ${String(clash)} resolve to an identical budget`).toBeUndefined();
      seen.set(key, mode);
    }
    expect(seen.size).toBe(EFFORT_MODES.length);
  });

  it('never lets a stronger mode buy less of anything', () => {
    // reduce without a seed walks adjacent pairs, so there is no index to be
    // possibly-undefined and no assertion needed to convince the compiler.
    EFFORT_MODES.map((mode) => ({ budget: effortBudget(mode), mode })).reduce(
      (weaker, stronger) => {
        for (const dimension of scaling) {
          expect(
            stronger.budget[dimension],
            `${stronger.mode} buys less ${dimension} than ${weaker.mode}`,
          ).toBeGreaterThanOrEqual(weaker.budget[dimension]);
        }
        expect(
          stronger.budget.maxRepairAttempts,
          `${stronger.mode} repairs less than ${weaker.mode}`,
        ).toBeGreaterThanOrEqual(weaker.budget.maxRepairAttempts);
        return stronger;
      },
    );
  });

  it('makes every scaling dimension take a real range of values', () => {
    // Paired with the monotonicity test above, "non-decreasing and at least
    // four distinct values across six modes" is what stops a dimension from
    // being nominally present but effectively constant. maxRepairAttempts is
    // bounded 0..1 by the schema and cannot reach four, so it is excluded here
    // and asserted on its own below.
    for (const dimension of scaling) {
      const ladder = EFFORT_MODES.map((mode) => effortBudget(mode)[dimension]);
      expect(
        new Set(ladder).size,
        `${dimension} is too flat to be a real difference: ${ladder.join(' → ')}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('spends the single repair attempt everywhere except the cheapest mode', () => {
    expect(effortBudget('LOW').maxRepairAttempts).toBe(0);
    for (const mode of EFFORT_MODES.filter((value) => value !== 'LOW')) {
      expect(effortBudget(mode).maxRepairAttempts, mode).toBe(1);
    }
  });

  it('never gives the default less of anything than runs historically had', () => {
    // A bigger ceiling cannot fail a run that used to pass; a smaller one can.
    // The legacy literal is written out rather than imported, so editing the
    // constant cannot quietly pass this.
    expect(DEFAULT_EFFORT_MODE).toBe('ULTRA');
    const legacy: RunBudget = {
      maxModelTurns: 40,
      maxToolCalls: 100,
      maxToolRounds: 100,
      maxRepairAttempts: 1,
      maxRuntimeMs: 7_200_000,
      maxOutputBytes: 16_777_216,
      maxToolResultBytes: 1_048_576,
    };
    expect(LEGACY_FIXED_BUDGET).toEqual(legacy);
    const budget = effortBudget(DEFAULT_EFFORT_MODE);
    for (const dimension of scaling) {
      expect(budget[dimension], dimension).toBeGreaterThanOrEqual(legacy[dimension]);
    }
    expect(budget.maxRepairAttempts).toBeGreaterThanOrEqual(legacy.maxRepairAttempts);
  });

  it('lets the top rung buy the protocol ceiling for model turns', () => {
    // 40 turns died on a real feature mission: discovery of a large monorepo
    // consumed the whole budget before a single file was written. The schema
    // allows 100; a top rung below the ceiling is a silent cap on missions.
    expect(effortBudget('ULTRA').maxModelTurns).toBe(100);
    expect(() => runBudgetSchema.parse(effortBudget('ULTRA'))).not.toThrow();
  });

  it('documents an orchestration contract for every mode', () => {
    for (const mode of EFFORT_MODES) {
      expect(EFFORT_MODE_CONTRACTS[mode].length, mode).toBeGreaterThan(40);
    }
    expect(new Set(Object.values(EFFORT_MODE_CONTRACTS)).size).toBe(EFFORT_MODES.length);
  });

  it('falls back to the default instead of throwing on unusable settings', () => {
    for (const value of [undefined, null, '', 'ultra', 'TURBO', 7, {}, []]) {
      expect(normalizeEffortMode(value)).toBe(DEFAULT_EFFORT_MODE);
    }
    for (const mode of EFFORT_MODES) {
      expect(normalizeEffortMode(mode)).toBe(mode);
    }
  });

  it('returns a fresh object so a caller cannot mutate the shared profile', () => {
    // Compares against a second read rather than a hardcoded number: the point
    // of this test is isolation between callers, and pinning HIGH's turn count
    // here made it fail for the unrelated reason that the budget was retuned.
    const baseline = effortBudget('HIGH').maxModelTurns;
    const first = effortBudget('HIGH');
    first.maxModelTurns = 999;
    expect(effortBudget('HIGH').maxModelTurns).toBe(baseline);
    expect(effortBudget('HIGH').maxModelTurns).not.toBe(999);
  });
});
