import { describe, expect, it, vi } from 'vitest';

import {
  buildReviewGraph,
  changedPathsFromDiff,
  selectReviewDimensions,
  verifyReviewFindings,
} from '../../src/core/code-review';
import { subAgentGraphSchema } from '../../src/core/multi-agent-dag';
import { ReviewToolExecutor } from '../../src/infrastructure/review-tool-executor';
import { FindingsService } from '../../src/services/findings-service';

import type { Finding } from '../../src/core/findings';
import type { SubAgentOutcome } from '../../src/core/multi-agent-dag';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const diff = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  'diff --git a/old.ts b/new.ts',
  'rename from old.ts',
].join('\n');

const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    title: 'Null dereference',
    severity: 'high',
    confidence: 'low',
    path: 'src/auth.ts',
    line: 3,
    detail: 'd',
    remediation: 'r',
    ...overrides,
  };
}

describe('code review graph', () => {
  it('reads changed paths from diff headers, by new name', () => {
    expect(changedPathsFromDiff(diff)).toEqual(['new.ts', 'src/auth.ts']);
    expect(changedPathsFromDiff('')).toEqual([]);
  });

  it('selects known dimensions in canonical order and refuses none', () => {
    expect(selectReviewDimensions(undefined)).toEqual([
      'correctness',
      'security',
      'tests',
      'performance',
    ]);
    expect(selectReviewDimensions(['tests', 'security', 'tests'])).toEqual(['security', 'tests']);
    expect(() => selectReviewDimensions(['style'])).toThrow('at least one');
  });

  it('builds a valid, independent, read-only graph, one reviewer per dimension', () => {
    const graph = buildReviewGraph({
      rootKey: 'workspace-0',
      runId: 'run-12345678',
      epochs,
      dimensions: ['correctness', 'security', 'tests'],
      diff: `${diff}\n${'x'.repeat(20_000)}`,
      changedPaths: ['src/auth.ts'],
      baseRef: 'main',
    });
    expect(() => subAgentGraphSchema.parse(graph)).not.toThrow();
    expect(graph.maxConcurrency).toBe(3);
    expect(graph.tasks.map((task) => [task.taskId, task.role, task.riskCeiling])).toEqual([
      ['review-correctness', 'reviewer', 'R0'],
      ['review-security', 'security-reviewer', 'R0'],
      ['review-tests', 'tester', 'R2'],
    ]);
    for (const task of graph.tasks) {
      expect(task.dependencies).toEqual([]);
      expect(task.writeSet).toEqual([]);
      expect(task.worktreeId).toBe('workspace-0');
      expect(task.goal.length).toBeLessThanOrEqual(20_000);
      expect(task.goal).toContain('truncated');
    }
    expect(() => buildReviewGraph({ ...graphInput(), dimensions: [] })).toThrow();
  });

  it('rejects out-of-diff findings, promotes corroborated ones, and ranks', () => {
    const verification = verifyReviewFindings(
      [
        finding({ source: 'correctness' }),
        finding({ source: 'security' }),
        finding({ path: 'src/elsewhere.ts', title: 'Unrelated' }),
        finding({
          title: 'Slow loop',
          severity: 'critical',
          confidence: 'high',
          source: 'performance',
        }),
      ],
      ['src/auth.ts'],
    );
    expect(verification.rejected.map((item) => item.path)).toEqual(['src/elsewhere.ts']);
    expect(verification.corroborated).toBe(1);
    expect(verification.selection.duplicatesRemoved).toBe(1);
    expect(verification.selection.findings.map((item) => [item.title, item.confidence])).toEqual([
      ['Slow loop', 'high'],
      ['Null dereference', 'medium'],
    ]);
  });
});

function graphInput() {
  return {
    rootKey: 'workspace-0',
    runId: 'run-12345678',
    epochs,
    dimensions: ['correctness'] as const,
    diff,
    changedPaths: ['src/auth.ts'],
    baseRef: 'HEAD',
  };
}

function invocation(args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv-12345678',
    runId: 'run-12345678',
    turnId: 'turn-12345678',
    toolName: 'runtime.review',
    toolVersion: '2.0.0',
    operation: 'run',
    arguments: args,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idem-12345678',
    requestedAt: '2026-09-29T10:00:00.000Z',
  } as ToolInvocation;
}

describe('ReviewToolExecutor', () => {
  it('fans out, withdraws out-of-scope findings from the view, and reports ranked results', async () => {
    const state = { update: vi.fn() };
    const findings = new FindingsService(state);
    const outside = finding({ path: 'src/elsewhere.ts', title: 'Unrelated' });
    // The observer files findings as each reviewer ends; simulate it.
    findings.record([finding(), outside]);
    const outcomes: SubAgentOutcome[] = [
      {
        taskId: 'review-correctness',
        status: 'succeeded',
        changedPaths: [],
        tokens: 1,
        toolCalls: 1,
        artifacts: [],
        findings: [finding(), outside],
      },
      {
        taskId: 'review-security',
        status: 'blocked',
        changedPaths: [],
        tokens: 0,
        toolCalls: 0,
        artifacts: [],
        findings: [],
        blocker: 'budget',
      },
    ];
    const agents = { run: vi.fn(async (_graph: unknown) => outcomes) };
    const git = {
      execute: vi.fn(async () => ({
        operation: 'diff' as const,
        beforeHead: null,
        afterHead: null,
        beforeWorkingTreeHash: 'h',
        afterWorkingTreeHash: 'h',
        output: diff,
      })),
    };
    const executor = new ReviewToolExecutor({ git, agents, findings });
    const result = await executor.execute(
      invocation({
        rootKey: 'workspace-0',
        baseBranch: 'main',
        dimensions: ['security', 'correctness'],
      }),
    );
    expect(git.execute).toHaveBeenCalledWith(
      { rootKey: 'workspace-0', operation: 'diff', ref: 'main' },
      undefined,
    );
    const graph = agents.run.mock.calls[0]?.[0] as { tasks: { taskId: string }[] };
    expect(graph.tasks.map((task) => task.taskId)).toEqual([
      'review-correctness',
      'review-security',
    ]);
    expect(result.structured).toMatchObject({
      reviewed: true,
      total: 1,
      rejectedOutOfScope: 1,
      blocking: false,
      reviewers: [
        { taskId: 'review-correctness', status: 'succeeded', findings: 2 },
        { taskId: 'review-security', status: 'blocked', blocker: 'budget' },
      ],
    });
    expect(findings.current().findings.map((item) => item.path)).toEqual(['src/auth.ts']);
  });

  it('reports an empty diff instead of starting reviewers', async () => {
    const agents = { run: vi.fn() };
    const git = {
      execute: vi.fn(async () => ({
        operation: 'diff' as const,
        beforeHead: null,
        afterHead: null,
        beforeWorkingTreeHash: 'h',
        afterWorkingTreeHash: 'h',
        output: '',
      })),
    };
    const executor = new ReviewToolExecutor({ git, agents, findings: { discard: vi.fn() } });
    const result = await executor.execute(invocation({ rootKey: 'workspace-0' }));
    expect(result.structured).toEqual({ reviewed: false, reason: 'empty-diff', baseRef: 'HEAD' });
    expect(agents.run).not.toHaveBeenCalled();
  });
});
