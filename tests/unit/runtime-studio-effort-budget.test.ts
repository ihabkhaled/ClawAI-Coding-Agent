import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EFFORT_MODES, effortBudget, type EffortMode } from '../../src/core/effort-mode';
import { executeRuntimeStudio } from '../../src/services/runtime-studio-execution';

import type { RunBudget } from '../../src/core/runtime/runtime-tool-contracts';
import type { RuntimeRunStart } from '../../src/services/runtime-run-service';

/** The journal schema accepts only `sha256:<64 hex>`. */
function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

interface Capture {
  readonly starts: RuntimeRunStart[];
  readonly journals: { budget: RunBudget; policySnapshotHash: string }[];
  readonly traces: Record<string, unknown>[];
}

/**
 * The studio builds its own RuntimeRunService, so the transport is the seam
 * where the budget becomes observable — it is the value the backend is asked
 * to admit and the value the tool dispatcher enforces.
 */
function harness(effortMode: EffortMode): { capture: Capture; run: () => Promise<void> } {
  const capture: Capture = { starts: [], journals: [], traces: [] };
  const manifest = { capabilities: [] } as never;
  const dependencies = {
    input: {
      prompt: 'add a test',
      threadId: 'thread-1',
      requestId: '5b1d0f0e-6b0a-4a1e-9c1a-2f3d4e5a6b7c',
      signal: new AbortController().signal,
      onEvent: () => undefined,
    },
    manifest,
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 } as never,
    router: { definitions: () => [] },
    policy: {} as never,
    transport: {
      cancel: async () => undefined,
      start: async (start: RuntimeRunStart) => {
        capture.starts.push(start);
        return { runId: 'runtime:captured' };
      },
      submitResult: async () => undefined,
    } as never,
    stream: { follow: async () => undefined } as never,
    observability: {
      emit: (trace: Record<string, unknown>) => {
        capture.traces.push(trace);
      },
    } as never,
    journals: {
      save: async (candidate: { budget: RunBudget; policySnapshotHash: string }) => {
        capture.journals.push(candidate);
      },
    } as never,
    flagship: { steerIfActive: () => undefined } as never,
    state: { applyRuntimeEvent: () => undefined } as never,
    configuration: () => ({ effortMode, permissionMode: 'ASK' }) as never,
    targetRouter: () => ({}) as never,
    fingerprint: async () => ({
      account: digest('account'),
      workspace: digest('workspace'),
      target: digest('target'),
      policy: digest('policy'),
      files: digest('files'),
      gitHead: digest('gitHead'),
    }),
    hash: (value: unknown) => digest(JSON.stringify(value)),
    setActive: () => undefined,
    releaseApprovals: () => undefined,
  };
  return { capture, run: () => executeRuntimeStudio(dependencies as never) };
}

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
