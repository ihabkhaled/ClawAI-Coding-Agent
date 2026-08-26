import { describe, expect, it, vi } from 'vitest';

import { recoverVscodeRuntime } from '../../src/services/vscode-runtime-recovery';

import type { DurableRunJournal } from '../../src/core/durable-run-journal';

const hash = `sha256:${'a'.repeat(64)}`;
const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
const fingerprints = {
  account: 'account:one',
  workspace: 'workspace:one',
  target: 'target:one',
  policy: 'policy:one',
  files: hash,
  gitHead: 'abc123',
};

function journal(runId: string, updatedAt: string, recovery = true): DurableRunJournal {
  return {
    schemaVersion: 1,
    runId,
    threadId: `thread:${runId}`,
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
    lastEventSequence: 4,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt,
    ...(recovery
      ? {
          recovery: {
            version: 1 as const,
            start: {
              turnId: `turn:${runId}`,
              clientRequestId: `request:${runId}`,
              idempotencyKey: `request:${runId}`,
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
              startedAtMs: 1,
              usage: {
                modelTurns: 0,
                toolCalls: 0,
                toolRounds: 0,
                repairAttempts: 0,
                outputBytes: 0,
                toolResultBytes: 0,
              },
            },
          },
        }
      : {}),
  };
}

describe('VS Code runtime startup recovery', () => {
  it('blocks an unsafe newest journal and adopts the next eligible run once', async () => {
    const unsafe = journal('runtime:unsafe-0001', '2026-08-26T00:00:03.000Z', false);
    const eligible = journal('runtime:eligible-0001', '2026-08-26T00:00:02.000Z');
    const terminal = {
      ...journal('runtime:done-0001', '2026-08-26T00:00:04.000Z'),
      lifecycle: 'completed' as const,
    };
    const bindings = [eligible, unsafe].map((candidate) => ({
      threadId: candidate.threadId,
      runId: candidate.runId,
      generation: `generation:${candidate.runId}`,
      epochs,
    }));
    const save = vi.fn(async () => undefined);
    const recover = vi.fn(
      async (_dependencies: unknown, _journal: DurableRunJournal, _binding: unknown) => undefined,
    );
    const result = await recoverVscodeRuntime(
      {
        bindings: { list: async () => bindings } as never,
        journals: { list: async () => [eligible, terminal, unsafe], save } as never,
        logger: { warn: vi.fn() },
        fingerprint: async () => fingerprints,
        setEpochs: vi.fn(),
        execution: () => ({}) as never,
        recover,
      },
      {
        prompt: 'recover',
        threadId: 'thread:recovery',
        requestId: 'request:recovery',
        signal: new AbortController().signal,
        onEvent: vi.fn(),
        onApproval: vi.fn(),
      },
      {} as never,
    );

    expect(result).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ runId: unsafe.runId, lifecycle: 'blocked-by-drift' }),
    );
    expect(recover).toHaveBeenCalledOnce();
    expect(recover.mock.calls[0]?.[1]).toMatchObject({ runId: eligible.runId });
  });
});
