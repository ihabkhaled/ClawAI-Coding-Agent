import { describe, expect, it, vi } from 'vitest';

import { renderImplementationPlanMarkdown } from '../../src/core/implementation-plan';
import { embedPlanRevision, planRevisionHash } from '../../src/core/plan-revision';
import { PlanningToolExecutor } from '../../src/infrastructure/planning-tool-executor';
import { AgentTaskService } from '../../src/services/agent-task-service';
import { FileTransactionService } from '../../src/services/file-transaction-service';
import { examplePlan } from '../helpers/implementation-plan';

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
      saveIfDirty: async () => undefined,
      snapshot: vi.fn(async () => {
        throw new Error('not used');
      }),
      apply: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    });

    await expect(
      new PlanningToolExecutor(transactions, new AgentTaskService({ update: vi.fn() })).execute(
        invocation(graph),
      ),
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
    // Round-tripped through JSON, like a real invocation off the wire: a
    // typed SubAgentGraph carries optional fields TypeScript won't let a
    // strict RuntimeJsonObject accept directly, but JSON never carries an
    // `undefined` property in the first place.
    arguments: { plan: JSON.parse(JSON.stringify(graph)), output: {} },
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idempotency:planning-test',
    requestedAt: '2026-08-20T12:00:00.000Z',
  };
}

describe('PlanningToolExecutor plan revisions', () => {
  function executor(): PlanningToolExecutor {
    const transactions = new FileTransactionService({
      isTrusted: () => true,
      saveIfDirty: async () => undefined,
      snapshot: vi.fn(async () => {
        throw new Error('not used');
      }),
      apply: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    });
    return new PlanningToolExecutor(transactions, new AgentTaskService({ update: vi.fn() }));
  }

  function planInvocation(operation: string, args: Record<string, unknown>): ToolInvocation {
    return {
      schemaVersion: '2.0',
      invocationId: 'invocation:planning-revision',
      runId: 'runtime:planning-revision',
      turnId: 'turn:planning-revision',
      toolName: 'workspace.planning',
      toolVersion: '2.0.0',
      operation,
      arguments: JSON.parse(JSON.stringify(args)),
      targetId: 'target:workspace',
      epochs,
    } as ToolInvocation;
  }

  const plan = examplePlan();
  const document = embedPlanRevision(renderImplementationPlanMarkdown(plan), plan);

  it('reports a first adopted document as a new revision', async () => {
    await expect(executor().execute(planInvocation('adopt', { document }))).resolves.toMatchObject({
      structured: { change: 'new', revision: planRevisionHash(plan) },
    });
  });

  it('reports an edit to the prose around a plan as unchanged', async () => {
    const subject = executor();
    await subject.execute(planInvocation('adopt', { document }));

    await expect(
      subject.execute(
        planInvocation('adopt', { document: `${document}\nA note the user typed.\n` }),
      ),
    ).resolves.toMatchObject({ structured: { change: 'unchanged' } });
  });

  it('reports an edit to the plan itself as a revision', async () => {
    const subject = executor();
    await subject.execute(planInvocation('adopt', { document }));

    await expect(
      subject.execute(
        planInvocation('adopt', {
          document: document.replace('"Reach parity"', '"Reach parity later"'),
        }),
      ),
    ).resolves.toMatchObject({ structured: { change: 'revised' } });
  });

  it('refuses work that names a revision the user has replaced', async () => {
    const subject = executor();
    await subject.execute(
      planInvocation('adopt', {
        document: document.replace('"Reach parity"', '"Reach parity later"'),
      }),
    );

    await expect(
      subject.execute(
        planInvocation('issue-payloads', {
          plan,
          revision: planRevisionHash(plan),
        }),
      ),
    ).rejects.toThrow(/stale/u);
  });

  it('allows work that names the adopted revision', async () => {
    const subject = executor();
    await subject.execute(planInvocation('adopt', { document }));

    await expect(
      subject.execute(
        planInvocation('issue-payloads', {
          plan,
          revision: planRevisionHash(plan),
        }),
      ),
    ).resolves.toMatchObject({ structured: { published: false } });
  });
});
