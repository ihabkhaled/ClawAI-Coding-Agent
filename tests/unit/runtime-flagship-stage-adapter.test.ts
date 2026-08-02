import { describe, expect, it, vi } from 'vitest';

import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import { RuntimeFlagshipStageAdapter } from '../../src/services/runtime-flagship-stage-adapter';

import type { SubAgentTask } from '../../src/core/multi-agent-dag';

const request = flagshipRequestSchema.parse({
  deliveryId: 'Flagship_Test_0001',
  runId: 'runtime-flagship-test',
  goal: 'Implement a bounded feature.',
  strategy: 'cross-stack-feature',
  repositories: ['workspace-root'],
  writeSet: ['src/feature.ts'],
  acceptanceChecks: ['Feature tests pass'],
  budget: {
    maxRuntimeMs: 172_800_000,
    maxStageAttempts: 2,
    maxModelTurns: 1_000,
    maxToolCalls: 100_000,
    maxSubAgents: 5,
  },
  effects: {
    commitAuthorized: true,
    pushAuthorized: false,
    deployAuthorized: false,
    publishAuthorized: false,
  },
});

const snapshot = {
  deliveryId: request.deliveryId,
  runId: request.runId,
  stage: 'implement' as const,
  lifecycle: 'running' as const,
  attempts: {},
  evidenceReferences: [],
  unverifiedClaims: [],
  steering: ['Preserve the public API.'],
  startedAt: '2026-08-02T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
};

describe('RuntimeFlagshipStageAdapter', () => {
  it('creates a bounded scoped implementation task and preserves steering', async () => {
    const execute = vi.fn(async (_task: SubAgentTask, steering: () => readonly string[]) => ({
      taskId: 'flagship-test-0001-implement',
      status: 'succeeded' as const,
      changedPaths: ['src/feature.ts'],
      tokens: 100,
      toolCalls: 3,
      artifacts: [...steering(), 'evidence:tests'],
    }));
    const adapter = new RuntimeFlagshipStageAdapter({ execute }, () => ({
      account: 1,
      workspace: 2,
      target: 3,
      policy: 4,
    }));

    await expect(
      adapter.execute('implement', request, snapshot, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'succeeded',
      evidenceReferences: ['Preserve the public API.', 'evidence:tests'],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'flagship-test-0001-implement',
        worktreeId: 'workspace-root',
        writeSet: ['src/feature.ts'],
        budget: expect.objectContaining({
          maxTokens: 4_096_000,
          maxToolCalls: 10_000,
          maxRuntimeMs: 86_400_000,
        }),
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('records authorization rails without asking a model to approve itself', async () => {
    const execute = vi.fn();
    const adapter = new RuntimeFlagshipStageAdapter({ execute }, () => ({
      account: 1,
      workspace: 2,
      target: 3,
      policy: 4,
    }));

    await expect(
      adapter.execute('authorize', request, snapshot, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'succeeded',
      evidenceReferences: [`policy:${request.deliveryId}`],
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
