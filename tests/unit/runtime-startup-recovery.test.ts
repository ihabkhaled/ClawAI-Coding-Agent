import { describe, expect, it } from 'vitest';

import { planRuntimeStartupRecovery } from '../../src/services/runtime-startup-recovery';

import type { DurableRunJournal } from '../../src/core/durable-run-journal';

const hash = `sha256:${'a'.repeat(64)}`;
const fingerprints = {
  account: 'account:one',
  workspace: 'workspace:one',
  target: 'target:one',
  policy: 'policy:one',
  files: hash,
  gitHead: 'abc123',
};
const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const journal = {
  schemaVersion: 1,
  runId: 'runtime:recovery-0001',
  threadId: 'thread:recovery-0001',
  lifecycle: 'resumable',
  goal: 'Resume safely.',
  policySnapshotHash: hash,
  capabilitySnapshotHash: hash,
  fingerprints,
  invocations: [],
  fileTransactionIds: [],
  processHandles: [],
  serviceHandles: [],
  budget: {},
  evidenceReferences: [],
  labels: [],
  pinned: false,
  lastEventSequence: 7,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:01.000Z',
  recovery: {
    version: 1,
    start: {
      turnId: 'turn:recovery-0001',
      clientRequestId: 'request:recovery-0001',
      idempotencyKey: 'request:recovery-0001',
      manifestHash: hash,
      toolCatalogHash: hash,
      provider: 'AUTO',
      model: 'AUTO',
      epochs,
      definitions: [],
    },
    budgetState: {
      budget: {
        maxModelTurns: 10,
        maxToolCalls: 20,
        maxToolRounds: 20,
        maxRepairAttempts: 1,
        maxRuntimeMs: 60_000,
        maxOutputBytes: 1_048_576,
        maxToolResultBytes: 262_144,
      },
      startedAtMs: Date.parse('2026-08-26T00:00:00.000Z'),
      usage: {
        modelTurns: 1,
        toolCalls: 2,
        toolRounds: 2,
        repairAttempts: 0,
        outputBytes: 100,
        toolResultBytes: 100,
      },
    },
  },
} satisfies DurableRunJournal;
const binding = {
  threadId: journal.threadId,
  runId: journal.runId,
  generation: 'generation:recovery-0001',
  epochs,
};
const liveHandles = { processes: new Set<string>(), services: new Set<string>() };

describe('runtime startup recovery planning', () => {
  it('accepts only a complete drift-free journal and matching binding', () => {
    expect(planRuntimeStartupRecovery(journal, binding, fingerprints, liveHandles)).toMatchObject({
      eligible: true,
      reasons: [],
    });
  });

  it('fails closed for legacy journals without a recovery capsule', () => {
    expect(
      planRuntimeStartupRecovery(
        { ...journal, recovery: undefined },
        binding,
        fingerprints,
        liveHandles,
      ),
    ).toMatchObject({ eligible: false, reasons: ['missing-recovery-capsule'] });
  });

  it('fails closed for missing bindings, epoch mismatch, and workspace drift', () => {
    expect(
      planRuntimeStartupRecovery(journal, undefined, fingerprints, liveHandles).reasons,
    ).toContain('missing-runtime-binding');
    expect(
      planRuntimeStartupRecovery(
        journal,
        { ...binding, epochs: { ...epochs, policy: 5 } },
        fingerprints,
        liveHandles,
      ).reasons,
    ).toContain('binding-epochs');
    expect(
      planRuntimeStartupRecovery(
        journal,
        binding,
        { ...fingerprints, workspace: 'workspace:changed' },
        liveHandles,
      ).reasons,
    ).toContain('workspace');
  });
});
