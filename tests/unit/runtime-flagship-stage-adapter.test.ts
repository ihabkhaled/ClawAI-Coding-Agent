import { describe, expect, it, vi } from 'vitest';

import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import {
  CoordinatedFlagshipSubAgentPort,
  RuntimeFlagshipStageAdapter,
} from '../../src/services/runtime-flagship-stage-adapter';

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
  stageSummaries: {},
  usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
  commits: [],
  startedAt: '2026-08-02T12:00:00.000Z',
  updatedAt: '2026-08-02T12:00:00.000Z',
};

describe('RuntimeFlagshipStageAdapter', () => {
  it('routes a flagship stage through the worktree-owning coordinator', async () => {
    const run = vi.fn(async () => [
      {
        taskId: 'flagship-test-0001-implement',
        status: 'succeeded' as const,
        commit: 'a'.repeat(40),
        changedPaths: ['src/feature.ts'],
        tokens: 1,
        toolCalls: 1,
        artifacts: [],
      },
    ]);
    const port = new CoordinatedFlagshipSubAgentPort({ run });
    const stageTask = {
      taskId: 'flagship-test-0001-implement',
      role: 'implementer',
      goal: 'Implement',
      modelPolicy: {
        allowedProviders: ['AUTO'],
        allowedModels: ['AUTO'],
        localPreferred: false,
        minimumContextTokens: 1_000,
      },
      contextNodeIds: [],
      dependencies: [],
      writeSet: ['src/feature.ts'],
      integrationSeams: [],
      worktreeId: 'flagship-test-0001-implement',
      budget: { maxTokens: 1_000, maxToolCalls: 1, maxRuntimeMs: 1_000, maxRetries: 0 },
      tools: ['workspace.files'],
      riskCeiling: 'R3',
      acceptanceChecks: ['done'],
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    } satisfies SubAgentTask;

    await expect(
      port.execute(stageTask, () => [], new AbortController().signal),
    ).resolves.toMatchObject({ commit: 'a'.repeat(40) });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [stageTask], maxConcurrency: 1 }),
      expect.any(AbortSignal),
    );
  });

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
        worktreeId: 'flagship-test-0001-implement',
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

  it('integrates verified stage commits through the host instead of a nested model', async () => {
    const execute = vi.fn();
    const integrate = vi.fn(async () => ({
      integrationId: 'integration-flagship-test',
      status: 'integrated' as const,
      integratedCommits: ['a'.repeat(40)],
      conflicts: [],
      semanticConflicts: [],
      gates: [{ gateId: 'project:unit:0', passed: true }],
    }));
    const adapter = new RuntimeFlagshipStageAdapter(
      { execute },
      () => ({ account: 1, workspace: 2, target: 3, policy: 4 }),
      { integrate },
    );
    const requestWithGates = { ...request, mandatoryGateIds: ['project:unit:0'] };
    const snapshotWithCommit = {
      ...snapshot,
      commits: [
        {
          taskId: 'flagship-test-0001-implement',
          worktreeId: 'flagship-test-0001-implement',
          commit: 'a'.repeat(40),
          changedPaths: ['src/feature.ts'],
          integrationSeams: [],
        },
      ],
    };

    await expect(
      adapter.execute(
        'integrate',
        requestWithGates,
        snapshotWithCommit,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(integrate).toHaveBeenCalledWith(
      expect.objectContaining({
        targetWorktreeId: 'workspace-root',
        commits: snapshotWithCommit.commits,
        mandatoryGateIds: ['project:unit:0'],
      }),
      expect.any(AbortSignal),
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
