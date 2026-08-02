import { describe, expect, it, vi } from 'vitest';

import { FileLeaseManager } from '../../src/services/file-lease-manager';
import {
  ScopedSubAgentExecutor,
  ScopedSubAgentPolicy,
} from '../../src/services/runtime-sub-agent-executor';
import { SubAgentCoordinatorService } from '../../src/services/sub-agent-coordinator-service';

import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';
import type { SubAgentTask } from '../../src/core/multi-agent-dag';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

describe('SubAgentCoordinatorService', () => {
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
});

function task(
  taskId: string,
  dependencies: readonly string[],
  writeSet: readonly string[],
  role: 'explorer' | 'implementer',
): SubAgentTask {
  return {
    taskId,
    role,
    goal: `Complete ${taskId}`,
    modelPolicy: {
      allowedProviders: ['OLLAMA'],
      allowedModels: ['qwen3:1.7b'],
      localPreferred: true,
      minimumContextTokens: 1_000,
    },
    contextNodeIds: [],
    dependencies: [...dependencies],
    writeSet: [...writeSet],
    integrationSeams: [],
    worktreeId: 'workspace-root',
    budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
    tools: ['workspace.files'],
    riskCeiling: 'R3',
    acceptanceChecks: ['Task completes'],
    epochs,
  };
}

function invocation(
  toolName: string,
  operation: string,
  argumentsValue: ToolInvocation['arguments'],
): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:subagent-test',
    runId: 'runtime:subagent-test',
    turnId: 'turn:subagent-test',
    toolName,
    toolVersion: '1.0.0',
    operation,
    arguments: argumentsValue,
    targetId: 'target:workspace-root',
    epochs,
    idempotencyKey: 'idempotency:subagent-test',
    requestedAt: '2026-08-02T12:00:00.000Z',
  };
}

function transaction(rootKey: string, path: string): RuntimeJsonObject {
  return {
    transactionId: 'transaction-subagent-test',
    summary: 'Apply a scoped test edit',
    operations: [{ kind: 'mkdir', rootKey, path }],
  };
}
