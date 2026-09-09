import { describe, expect, it } from 'vitest';

import { EFFORT_MODES, effortBudget } from '../../src/core/effort-mode';
import { studioHarness as harness } from '../helpers/runtime-studio-harness';

describe('runtime studio effort budget', () => {
  it('starts every run with the budget its effort mode dictates', async () => {
    for (const mode of EFFORT_MODES) {
      const { capture, run } = harness(mode);
      await run();
      expect(capture.starts, mode).toHaveLength(1);
      expect(capture.starts[0]?.budget, mode).toEqual(effortBudget(mode));
    }
  });

  it('no longer sends one fixed budget regardless of the setting', async () => {
    const low = harness('LOW');
    await low.run();
    const ultra = harness('ULTRA');
    await ultra.run();
    expect(low.capture.starts[0]?.budget).not.toEqual(ultra.capture.starts[0]?.budget);
    expect(low.capture.starts[0]?.budget.maxModelTurns).toBeLessThan(
      ultra.capture.starts[0]?.budget.maxModelTurns ?? 0,
    );
  });

  it('records the same budget in the journal the run was admitted with', async () => {
    const { capture, run } = harness('HIGH');
    await run();
    expect(capture.journals[0]?.budget).toEqual(effortBudget('HIGH'));
    expect(capture.journals[0]?.budget).toEqual(capture.starts[0]?.budget);
  });

  it('names the effort mode in the run trace', async () => {
    const { capture, run } = harness('MAX');
    await run();
    const attributes = capture.traces[0]?.attributes as Record<string, unknown> | undefined;
    expect(attributes?.effortMode).toBe('MAX');
  });

  it('gives two effort modes different policy snapshots', async () => {
    // The snapshot hash is what a replay uses to decide whether the conditions
    // it is reproducing still hold. Two runs that were allowed to spend
    // different amounts are not the same conditions.
    const max = harness('MAX');
    await max.run();
    const low = harness('LOW');
    await low.run();
    expect(max.capture.journals[0]?.policySnapshotHash).not.toBe(
      low.capture.journals[0]?.policySnapshotHash,
    );
  });
});
