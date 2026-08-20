import { describe, expect, it, vi } from 'vitest';

import { FileLeaseManager } from '../../src/services/file-lease-manager';
import {
  ScopedSubAgentExecutor,
  ScopedSubAgentPolicy,
} from '../../src/services/runtime-sub-agent-executor';
import { SubAgentCoordinatorService } from '../../src/services/sub-agent-coordinator-service';
import {
  subAgentEpochs as epochs,
  subAgentInvocation as invocation,
  subAgentTask as task,
  subAgentTransaction as transaction,
  successfulOutcome,
} from '../helpers/sub-agent';

import type { SubAgentGraph, SubAgentOutcome, SubAgentTask } from '../../src/core/multi-agent-dag';

describe('SubAgentCoordinatorService', () => {
  it('limits disjoint ready tasks to the admitted concurrency cap', async () => {
    const started: string[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor = {
      execute: vi.fn(async (current: SubAgentTask) => {
        started.push(current.taskId);
        await gate;
        return successfulOutcome(current.taskId);
      }),
    };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
    );
    const run = coordinator.run(
      {
        graphId: 'graph-admitted-concurrency',
        parentRunId: 'runtime-parent-0001',
        maxConcurrency: 2,
        tasks: [
          task('lane-a', [], ['src/a.ts'], 'implementer'),
          task('lane-b', [], ['src/b.ts'], 'implementer'),
        ],
      },
      undefined,
      1,
    );

    await vi.waitFor(() => {
      expect(started.length).toBeGreaterThan(0);
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const startedBeforeRelease = [...started];
    release();
    await expect(run).resolves.toHaveLength(2);

    expect(startedBeforeRelease).toEqual(['lane-a']);
  });

  it('waits for every dependency while two disjoint ready tasks run concurrently', async () => {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    const executor = {
      execute: vi.fn(async (current: SubAgentTask) => {
        started.push(current.taskId);
        if (current.dependencies.length === 0) {
          await new Promise<void>((resolve) => releases.set(current.taskId, resolve));
        }
        return successfulOutcome(current.taskId);
      }),
    };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
    );
    const run = coordinator.run({
      graphId: 'graph-dependency-waiting',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 2,
      tasks: [
        task('lane-a', [], ['src/a.ts'], 'implementer'),
        task('lane-b', [], ['src/b.ts'], 'implementer'),
        task('integrate-lanes', ['lane-a', 'lane-b'], ['src/integration.ts'], 'implementer'),
      ],
    });

    await vi.waitFor(() => {
      expect(started).toEqual(['lane-a', 'lane-b']);
    });
    releases.get('lane-a')?.();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(started).not.toContain('integrate-lanes');
    releases.get('lane-b')?.();
    await expect(run).resolves.toHaveLength(3);
    expect(started).toEqual(['lane-a', 'lane-b', 'integrate-lanes']);
  });

  it('rejects colliding graph write sets before starting a task', async () => {
    const executor = {
      execute: vi.fn(async (current: SubAgentTask) => successfulOutcome(current.taskId)),
    };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
    );

    await expect(
      coordinator.run({
        graphId: 'graph-write-collision',
        parentRunId: 'runtime-parent-0001',
        maxConcurrency: 2,
        tasks: [
          task('lane-a', [], ['src/shared.ts'], 'implementer'),
          task('lane-b', [], ['src/shared.ts'], 'implementer'),
        ],
      }),
    ).rejects.toThrow(/write collision/iu);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('runs dependency-ready tasks, preserves steering, and enforces declared leases', async () => {
    const order: string[] = [];
    const executor = {
      execute: vi.fn(async (task: { taskId: string }, steering: () => readonly string[]) => {
        order.push(task.taskId);
        return {
          taskId: task.taskId,
          status: 'succeeded' as const,
          changedPaths: task.taskId === 'implement-ui' ? ['src/ui.ts'] : [],
          tokens: 10,
          toolCalls: 1,
          artifacts: [...steering()],
        };
      }),
    };
    const observer = { status: vi.fn(), outcome: vi.fn() };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      observer,
    );
    const graph = {
      graphId: 'graph-runtime-0001',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 2,
      tasks: [
        task('inspect-code', [], [], 'explorer'),
        task('implement-ui', ['inspect-code'], ['src/ui.ts'], 'implementer'),
      ],
    };

    const run = coordinator.run(graph);
    coordinator.steer('implement-ui', 'Keep the public API stable.');
    const outcomes = await run;

    expect(order).toEqual(['inspect-code', 'implement-ui']);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[1]?.artifacts).toContain('Keep the public API stable.');
    expect(observer.outcome).toHaveBeenCalledTimes(2);
  });

  it('denies undeclared writes, worktree escapes, and direct Git mutation', async () => {
    const delegate = { execute: vi.fn(async () => ({ structured: { ok: true } })) };
    const telemetry = {
      changedPaths: new Set<string>(),
      artifacts: new Set<string>(),
      tokens: 0,
      toolCalls: 0,
      modelTurns: 0,
      status: 'failed' as const,
    };
    const executor = new ScopedSubAgentExecutor(
      {
        ...task('implement-ui', [], ['src/ui.ts'], 'implementer'),
        tools: ['workspace.files', 'workspace.git'],
      },
      delegate,
      telemetry,
    );

    await expect(
      executor.execute(
        invocation('workspace.files', 'apply', {
          transaction: transaction('workspace-root', 'src/other.ts'),
        }),
      ),
    ).rejects.toThrow(/outside its lease/iu);
    await expect(
      executor.execute(invocation('workspace.files', 'read', { rootKey: 'another-worktree' })),
    ).rejects.toThrow(/leave its worktree/iu);
    await expect(
      executor.execute(
        invocation('workspace.files', 'read', {
          command: { cwdRootKey: 'another-worktree' },
        }),
      ),
    ).rejects.toThrow(/leave its worktree/iu);
    await expect(
      executor.execute(invocation('workspace.git', 'commit', { rootKey: 'workspace-root' })),
    ).rejects.toThrow(/integrator/iu);
    expect(delegate.execute).not.toHaveBeenCalled();
  });

  it('applies the task risk ceiling before delegating policy', async () => {
    const delegate = {
      evaluate: vi.fn(async () => ({ decision: 'allow' as const, code: 'OK', message: 'Allowed' })),
    };
    const lowRisk = new ScopedSubAgentPolicy(
      { ...task('inspect-code', [], [], 'explorer'), riskCeiling: 'R0' },
      delegate,
    );

    await expect(lowRisk.evaluate(invocation('workspace.process', 'run', {}))).resolves.toEqual({
      decision: 'deny',
      code: 'SUB_AGENT_RISK_CEILING',
      message: 'Risk ceiling exceeded',
    });
    expect(delegate.evaluate).not.toHaveBeenCalled();
  });

  it('retains a host-validated planning graph in sub-agent telemetry', async () => {
    const planGraph = {
      graphId: 'graph-planner-output',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 1,
      tasks: [task('planned-task', [], ['src/planned.ts'], 'implementer')],
    } satisfies SubAgentGraph;
    const delegate = {
      execute: vi.fn(async () => ({ structured: { graph: planGraph, valid: true } })),
    };
    const telemetry: {
      changedPaths: Set<string>;
      artifacts: Set<string>;
      tokens: number;
      toolCalls: number;
      modelTurns: number;
      status: 'failed';
      graph?: SubAgentGraph;
    } = {
      changedPaths: new Set<string>(),
      artifacts: new Set<string>(),
      tokens: 0,
      toolCalls: 0,
      modelTurns: 0,
      status: 'failed' as const,
    };
    const plannerTask = {
      ...task('plan-work', [], [], 'explorer'),
      tools: ['workspace.planning'],
    };
    const executor = new ScopedSubAgentExecutor(plannerTask, delegate, telemetry);

    await executor.execute(
      invocation('workspace.planning', 'validate', { plan: planGraph, output: {} }),
    );

    expect(telemetry.graph).toEqual(planGraph);
  });

  it('keeps unusable artifact strings out of sub-agent evidence', async () => {
    const delegate = { execute: vi.fn(async () => ({ structured: { ok: true } })) };
    const telemetry = {
      changedPaths: new Set<string>(),
      artifacts: new Set<string>(),
      tokens: 0,
      toolCalls: 0,
      modelTurns: 0,
      status: 'failed' as const,
    };
    const executor = new ScopedSubAgentExecutor(
      { ...task('implement-ui', [], ['src/ui.ts'], 'implementer'), tools: ['workspace.browser'] },
      delegate,
      telemetry,
    );

    await executor.execute(
      invocation('workspace.browser', 'screenshot', { artifactPath: '', output: '   ' }),
    );
    await executor.execute(
      invocation('workspace.browser', 'screenshot', { artifactPath: 'x'.repeat(2_001) }),
    );
    await executor.execute(
      invocation('workspace.browser', 'screenshot', { artifactPath: 'evidence/shot.png' }),
    );

    expect([...telemetry.artifacts]).toEqual(['evidence/shot.png']);
  });

  it('does not retry an ambiguous failed task with a fresh idempotency key', async () => {
    const executor = { execute: vi.fn(async () => Promise.reject(new Error('response lost'))) };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
    );
    const retryingTask = task('effectful-task', [], ['src/effect.ts'], 'implementer');

    const [outcome] = await coordinator.run({
      graphId: 'graph-no-unsafe-retry',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 1,
      tasks: [{ ...retryingTask, budget: { ...retryingTask.budget, maxRetries: 3 } }],
    });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(outcome?.status).toBe('failed');
  });

  it('provisions an isolated worktree and returns only host-verified provenance', async () => {
    const isolated = {
      ...task('implement-ui', [], ['src/ui.ts'], 'implementer'),
      worktreeId: 'agent-ui',
    };
    const workspace = {
      prepare: vi.fn(async () => undefined),
      finalize: vi.fn(async (_task: SubAgentTask, outcome: SubAgentOutcome) => ({
        ...outcome,
        commit: '0123456789abcdef0123456789abcdef01234567',
        changedPaths: ['src/ui.ts'],
      })),
      abandon: vi.fn(async () => undefined),
    };
    const executor = {
      execute: vi.fn(async () => ({
        taskId: isolated.taskId,
        status: 'succeeded' as const,
        changedPaths: [],
        tokens: 4,
        toolCalls: 1,
        artifacts: [],
      })),
    };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
      workspace,
    );

    const [outcome] = await coordinator.run({
      graphId: 'graph-isolated-worktree',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 1,
      tasks: [isolated],
    });

    expect(workspace.prepare).toHaveBeenCalledWith(isolated, expect.any(AbortSignal));
    expect(workspace.finalize).toHaveBeenCalled();
    expect(workspace.abandon).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      commit: '0123456789abcdef0123456789abcdef01234567',
      changedPaths: ['src/ui.ts'],
    });
  });

  it('releases a worktree when the task fails without throwing, so a retry can reuse it', async () => {
    // The nested runtime can end with a `run.failed` event and still return
    // its outcome normally rather than throwing, so this path bypasses the
    // coordinator's own catch block. Nothing has a commit to integrate for a
    // failed task, and nothing else ever releases its worktree — a retry of
    // the same worktreeId used to fail immediately with "already active".
    const isolated = {
      ...task('implement-ui', [], ['src/ui.ts'], 'implementer'),
      worktreeId: 'agent-ui',
    };
    const workspace = {
      prepare: vi.fn(async () => undefined),
      finalize: vi.fn(async (_task: SubAgentTask, outcome: SubAgentOutcome) => outcome),
      abandon: vi.fn(async () => undefined),
    };
    const executor = {
      execute: vi.fn(async () => ({
        taskId: isolated.taskId,
        status: 'failed' as const,
        changedPaths: [],
        tokens: 0,
        toolCalls: 0,
        artifacts: [],
        blocker: 'Nested runtime failed',
      })),
    };
    const coordinator = new SubAgentCoordinatorService(
      executor,
      new FileLeaseManager(),
      () => epochs,
      { status: () => undefined, outcome: () => undefined },
      workspace,
    );

    const [outcome] = await coordinator.run({
      graphId: 'graph-failed-worktree',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 1,
      tasks: [isolated],
    });

    expect(workspace.finalize).not.toHaveBeenCalled();
    expect(workspace.abandon).toHaveBeenCalledWith(isolated);
    expect(outcome?.status).toBe('failed');
  });
});
