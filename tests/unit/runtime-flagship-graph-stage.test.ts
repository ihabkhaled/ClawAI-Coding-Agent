import { describe, expect, it, vi } from 'vitest';

import {
  CoordinatedFlagshipSubAgentPort,
  RuntimeFlagshipStageAdapter,
} from '../../src/services/runtime-flagship-stage-adapter';
import {
  flagshipHostEpochs,
  flagshipImplementationGraph,
  flagshipStageRequest,
  flagshipStageSnapshot,
  successfulGraphOutcome,
} from '../helpers/flagship-stage';

import type { SubAgentGraph } from '../../src/core/multi-agent-dag';

const request = flagshipStageRequest();
const snapshot = flagshipStageSnapshot();
const implementationGraph = flagshipImplementationGraph();

describe('RuntimeFlagshipStageAdapter implementation graph', () => {
  it('passes the complete implementation graph and admitted concurrency to the coordinator', async () => {
    const run = vi.fn(async () => [
      {
        taskId: 'implement-api',
        status: 'succeeded' as const,
        commit: 'a'.repeat(40),
        changedPaths: ['src/api.ts'],
        tokens: 10,
        toolCalls: 2,
        modelTurns: 1,
        artifacts: ['evidence:api'],
      },
      {
        taskId: 'implement-ui',
        status: 'succeeded' as const,
        commit: 'b'.repeat(40),
        changedPaths: ['src/ui.ts'],
        tokens: 20,
        toolCalls: 3,
        modelTurns: 2,
        artifacts: ['evidence:ui'],
      },
    ]);
    const adapter = new RuntimeFlagshipStageAdapter(
      new CoordinatedFlagshipSubAgentPort({ run }),
      flagshipHostEpochs,
    );

    await expect(
      adapter.execute(
        'implement',
        request,
        { ...snapshot, graph: implementationGraph },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: 'succeeded',
      evidenceReferences: ['evidence:api', 'evidence:ui'],
      taskOutcomes: [
        { taskId: 'implement-api', status: 'succeeded', attempts: 1 },
        { taskId: 'implement-ui', status: 'succeeded', attempts: 1 },
      ],
      usage: { modelTurns: 3, toolCalls: 5, subAgents: 2 },
      commits: [
        { taskId: 'implement-api', worktreeId: 'flagship-api', commit: 'a'.repeat(40) },
        { taskId: 'implement-ui', worktreeId: 'flagship-ui', commit: 'b'.repeat(40) },
      ],
    });
    expect(run).toHaveBeenCalledWith(
      implementationGraph,
      expect.any(AbortSignal),
      implementationGraph.maxConcurrency,
    );
  });

  it('partitions aggregate remaining turns and tools across every graph task', async () => {
    const run = vi.fn(async (graph: SubAgentGraph) =>
      graph.tasks.map((task) => ({
        taskId: task.taskId,
        status: 'succeeded' as const,
        changedPaths: task.writeSet,
        tokens: 1,
        toolCalls: 1,
        modelTurns: 1,
        artifacts: [],
      })),
    );
    const adapter = new RuntimeFlagshipStageAdapter(
      new CoordinatedFlagshipSubAgentPort({ run }),
      flagshipHostEpochs,
    );
    const largeBudgetGraph = {
      ...implementationGraph,
      tasks: implementationGraph.tasks.map((task) => ({
        ...task,
        budget: { ...task.budget, maxTokens: 100_000, maxToolCalls: 100 },
      })),
    };

    await adapter.execute(
      'implement',
      request,
      {
        ...snapshot,
        graph: largeBudgetGraph,
        usage: { modelTurns: 997, toolCalls: 99_995, subAgents: 0 },
      },
      new AbortController().signal,
    );

    const admitted = run.mock.calls[0]?.[0];
    expect(admitted?.tasks.map(({ budget }) => budget.maxTokens)).toEqual([8_192, 4_096]);
    expect(admitted?.tasks.map(({ budget }) => budget.maxToolCalls)).toEqual([3, 2]);
  });

  it('rejects a graph that cannot reserve one remaining turn and tool per task', async () => {
    const execute = vi.fn();
    const executeGraph = vi.fn();
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph }, flagshipHostEpochs);

    await expect(
      adapter.execute(
        'implement',
        request,
        {
          ...snapshot,
          graph: implementationGraph,
          usage: { modelTurns: 999, toolCalls: 99_999, subAgents: 0 },
        },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'blocked' });
    expect(executeGraph).not.toHaveBeenCalled();
  });

  it('stamps live host epochs onto every admitted graph task', async () => {
    const run = vi.fn(async (graph: SubAgentGraph) =>
      graph.tasks.map((task) => ({
        taskId: task.taskId,
        status: 'succeeded' as const,
        changedPaths: task.writeSet,
        tokens: 1,
        toolCalls: 1,
        modelTurns: 1,
        artifacts: [],
      })),
    );
    const adapter = new RuntimeFlagshipStageAdapter(
      new CoordinatedFlagshipSubAgentPort({ run }),
      () => ({ account: 9, workspace: 8, target: 7, policy: 6 }),
    );
    const staleGraph = {
      ...implementationGraph,
      tasks: implementationGraph.tasks.map((task) => ({
        ...task,
        epochs: { account: 0, workspace: 0, target: 0, policy: 0 },
      })),
    };

    await adapter.execute(
      'implement',
      request,
      { ...snapshot, graph: staleGraph },
      new AbortController().signal,
    );

    const admitted = run.mock.calls[0]?.[0];
    expect(admitted?.tasks.map(({ epochs }) => epochs)).toEqual([
      { account: 9, workspace: 8, target: 7, policy: 6 },
      { account: 9, workspace: 8, target: 7, policy: 6 },
    ]);
  });

  it('refuses a graph task that writes outside the authorized request write set', async () => {
    const execute = vi.fn();
    const executeGraph = vi.fn();
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph }, flagshipHostEpochs);
    const escapingGraph = {
      ...implementationGraph,
      tasks: implementationGraph.tasks.map((task, index) =>
        index === 0 ? { ...task, writeSet: ['.github/workflows/ci.yml'] } : task,
      ),
    };

    await expect(
      adapter.execute(
        'implement',
        request,
        { ...snapshot, graph: escapingGraph },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'blocked', commits: [] });
    expect(executeGraph).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing',
      outcomes: [successfulGraphOutcome('implement-api')],
    },
    {
      label: 'duplicate',
      outcomes: [successfulGraphOutcome('implement-api'), successfulGraphOutcome('implement-api')],
    },
    {
      label: 'unknown',
      outcomes: [
        successfulGraphOutcome('implement-api'),
        successfulGraphOutcome('implement-ui'),
        successfulGraphOutcome('implement-other'),
      ],
    },
  ])('does not accept a $label graph outcome identity set', async ({ outcomes }) => {
    const execute = vi.fn();
    const executeGraph = vi.fn(async () => outcomes);
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph }, flagshipHostEpochs);

    await expect(
      adapter.execute(
        'implement',
        request,
        { ...snapshot, graph: implementationGraph },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ status: 'recoverable-failure', commits: [] });
  });

  it('scopes a replan to the failed task and its descendants, keeping independent successes', async () => {
    const [apiTask] = implementationGraph.tasks;
    if (apiTask === undefined) throw new Error('fixture graph must declare tasks');
    const dependentGraph = {
      ...implementationGraph,
      tasks: [
        ...implementationGraph.tasks,
        {
          ...apiTask,
          taskId: 'wire-together',
          dependencies: ['implement-api'],
          writeSet: ['src/feature.ts'],
          worktreeId: 'flagship-wire',
        },
      ],
    };
    const executeGraph = vi.fn(async () => [
      { ...successfulGraphOutcome('implement-api'), status: 'failed' as const },
      successfulGraphOutcome('implement-ui'),
      { ...successfulGraphOutcome('wire-together'), status: 'blocked' as const },
    ]);
    const adapter = new RuntimeFlagshipStageAdapter(
      { execute: vi.fn(), executeGraph },
      flagshipHostEpochs,
    );

    const result = await adapter.execute(
      'implement',
      request,
      { ...snapshot, graph: dependentGraph },
      new AbortController().signal,
    );

    expect(result.requiresReplan).toBe(true);
    expect(result.recoveryHistory?.[0]?.strategy).toBe('replan');
    expect(result.summary).toContain('implement-api');
    expect(result.summary).toContain('wire-together');
    expect(result.summary).not.toContain('implement-ui');
  });

  it('blocks implementation when the plan snapshot has no validated graph', async () => {
    const execute = vi.fn();
    const executeGraph = vi.fn();
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph }, flagshipHostEpochs);

    await expect(
      adapter.execute('implement', request, snapshot, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'blocked',
      unverifiedClaims: ['implement did not complete'],
    });
    expect(execute).not.toHaveBeenCalled();
    expect(executeGraph).not.toHaveBeenCalled();
  });
});
