import { describe, expect, it, vi } from 'vitest';

import {
  CoordinatedFlagshipSubAgentPort,
  RuntimeFlagshipStageAdapter,
} from '../../src/services/runtime-flagship-stage-adapter';
import {
  flagshipImplementationGraph,
  flagshipStageRequest,
  flagshipStageSnapshot,
} from '../helpers/flagship-stage';

import type { SubAgentTask } from '../../src/core/multi-agent-dag';

const request = flagshipStageRequest();
const snapshot = flagshipStageSnapshot();
const implementationGraph = flagshipImplementationGraph();

describe('RuntimeFlagshipStageAdapter', () => {
  it('persists a host-validated plan graph and executes it in the implementation stage', async () => {
    const execute = vi.fn(async (task: SubAgentTask) => ({
      taskId: task.taskId,
      status: 'succeeded' as const,
      changedPaths: [],
      tokens: 10,
      toolCalls: 1,
      modelTurns: 1,
      artifacts: ['evidence:plan'],
      graph: implementationGraph,
    }));
    const executeGraph = vi.fn(async () =>
      implementationGraph.tasks.map((task) => ({
        taskId: task.taskId,
        status: 'succeeded' as const,
        changedPaths: task.writeSet,
        tokens: 10,
        toolCalls: 1,
        modelTurns: 1,
        artifacts: [`evidence:${task.taskId}`],
      })),
    );
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph }, () => ({
      account: 1,
      workspace: 2,
      target: 3,
      policy: 4,
    }));

    const planResult = await adapter.execute(
      'plan',
      request,
      snapshot,
      new AbortController().signal,
    );
    expect(planResult).toMatchObject({ status: 'succeeded', graph: implementationGraph });

    await expect(
      adapter.execute(
        'implement',
        request,
        { ...snapshot, graph: planResult.graph },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'succeeded', graph: implementationGraph });
    expect(executeGraph).toHaveBeenCalledOnce();
  });

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

  it('retains bounded single-task execution for non-implementation stages', async () => {
    const execute = vi.fn(async (_task: SubAgentTask, steering: () => readonly string[]) => ({
      taskId: 'flagship-test-0001-verify',
      status: 'succeeded' as const,
      changedPaths: [],
      tokens: 100,
      toolCalls: 3,
      artifacts: [...steering(), 'evidence:tests'],
    }));
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph: vi.fn() }, () => ({
      account: 1,
      workspace: 2,
      target: 3,
      policy: 4,
    }));

    await expect(
      adapter.execute('verify', request, snapshot, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'succeeded',
      evidenceReferences: ['Preserve the public API.', 'evidence:tests'],
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'flagship-test-0001-verify',
        worktreeId: 'workspace-root',
        writeSet: [],
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
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph: vi.fn() }, () => ({
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
      { execute, executeGraph: vi.fn() },
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
