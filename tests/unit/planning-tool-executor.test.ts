import { describe, expect, it, vi } from 'vitest';

import { PlanningToolExecutor } from '../../src/infrastructure/planning-tool-executor';
import { FileTransactionService } from '../../src/services/file-transaction-service';

import type { SubAgentGraph } from '../../src/core/multi-agent-dag';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

describe('PlanningToolExecutor', () => {
  it('returns a host-validated sub-agent graph from the validate operation', async () => {
    const graph = {
      graphId: 'graph-planning-output',
      parentRunId: 'runtime-parent-0001',
      maxConcurrency: 1,
      tasks: [
        {
          taskId: 'implement-feature',
          role: 'implementer',
          goal: 'Implement the feature',
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
          worktreeId: 'feature-worktree',
          budget: {
            maxTokens: 10_000,
            maxToolCalls: 10,
            maxRuntimeMs: 10_000,
            maxRetries: 0,
          },
          tools: ['workspace.files'],
          riskCeiling: 'R3',
          acceptanceChecks: ['Feature tests pass'],
          epochs,
        },
      ],
    } satisfies SubAgentGraph;
    const transactions = new FileTransactionService({
      isTrusted: () => true,
      snapshot: vi.fn(async () => {
        throw new Error('not used');
      }),
      apply: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    });

    await expect(
      new PlanningToolExecutor(transactions).execute(invocation(graph)),
    ).resolves.toEqual({ structured: { graph, valid: true } });
  });
});

function invocation(graph: SubAgentGraph): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:planning-test',
    runId: 'runtime:planning-test',
    turnId: 'turn:planning-test',
    toolName: 'workspace.planning',
    toolVersion: '2.0.0',
    operation: 'validate',
    arguments: { plan: graph, output: {} },
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idempotency:planning-test',
    requestedAt: '2026-08-20T12:00:00.000Z',
  };
}
