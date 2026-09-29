import { describe, expect, it, vi } from 'vitest';

import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import { FlagshipDeliveryService } from '../../src/services/flagship-delivery-service';
import { RuntimeFlagshipStageAdapter } from '../../src/services/runtime-flagship-stage-adapter';
import {
  flagshipDeliveryRequest,
  flagshipStageRequest,
  flagshipStageSnapshot,
} from '../helpers/flagship-stage';

import type {
  FlagshipStage,
  FlagshipStageDefinition,
  FlagshipStageResult,
} from '../../src/core/flagship-delivery';
import type { ResolvedFlagshipStage } from '../../src/core/flagship-stage';
import type { SubAgentTask } from '../../src/core/multi-agent-dag';

const stages: FlagshipStageDefinition[] = [
  { id: 'survey', kind: 'discover', acceptanceChecks: ['Entry points are listed'] },
  { id: 'design', kind: 'plan', acceptanceChecks: ['A graph is validated'] },
  { id: 'audit-pass', kind: 'review', acceptanceChecks: ['Findings are cited'] },
];

function memoryCheckpoints() {
  return {
    save: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
}

function succeeded(summary: string): FlagshipStageResult {
  return { status: 'succeeded', summary, evidenceReferences: [], unverifiedClaims: [] };
}

describe('goal-declared flagship stages', () => {
  it('runs the declared stages in order and hands each its definition', async () => {
    const seen: [FlagshipStage, string | undefined][] = [];
    const stage = {
      execute: vi.fn(
        async (
          kind: FlagshipStage,
          _request: unknown,
          _snapshot: unknown,
          _signal: AbortSignal,
          definition?: ResolvedFlagshipStage,
        ) => {
          seen.push([kind, definition?.id]);
          return succeeded(`${definition?.id ?? kind} complete`);
        },
      ),
    };
    const snapshot = await new FlagshipDeliveryService(stage, memoryCheckpoints(), {
      update: vi.fn(),
    }).run({ ...flagshipDeliveryRequest(), stages });

    expect(snapshot.lifecycle).toBe('done');
    expect(seen).toEqual([
      ['discover', 'survey'],
      ['plan', 'design'],
      ['review', 'audit-pass'],
    ]);
    expect(snapshot.stage).toBe('audit-pass');
    expect(snapshot.attempts).toEqual({ survey: 1, design: 1, 'audit-pass': 1 });
    expect(snapshot.stageSummaries['audit-pass']).toBe('audit-pass complete');
  });

  it('returns to the declared plan stage when a stage asks for a replan', async () => {
    const order: string[] = [];
    let reviews = 0;
    const stage = {
      execute: vi.fn(
        async (
          kind: FlagshipStage,
          _request: unknown,
          _snapshot: unknown,
          _signal: AbortSignal,
          definition?: ResolvedFlagshipStage,
        ): Promise<FlagshipStageResult> => {
          order.push(definition?.id ?? kind);
          if (kind === 'review' && reviews++ === 0) {
            return {
              ...succeeded('stale plan'),
              status: 'recoverable-failure',
              requiresReplan: true,
            };
          }
          return succeeded('ok');
        },
      ),
    };
    await new FlagshipDeliveryService(stage, memoryCheckpoints(), { update: vi.fn() }).run({
      ...flagshipDeliveryRequest(),
      stages,
    });
    expect(order).toEqual(['survey', 'design', 'audit-pass', 'design', 'audit-pass']);
  });

  it('retries the same stage when the list has no plan stage to return to', async () => {
    const order: string[] = [];
    let attempts = 0;
    const stage = {
      execute: vi.fn(async (kind: FlagshipStage): Promise<FlagshipStageResult> => {
        order.push(kind);
        if (attempts++ === 0) {
          return { ...succeeded('retry'), status: 'recoverable-failure', requiresReplan: true };
        }
        return succeeded('ok');
      }),
    };
    const snapshot = await new FlagshipDeliveryService(stage, memoryCheckpoints(), {
      update: vi.fn(),
    }).run({
      ...flagshipDeliveryRequest(),
      stages: [{ id: 'audit-only', kind: 'review', acceptanceChecks: ['Findings are cited'] }],
    });
    expect(order).toEqual(['review', 'review']);
    expect(snapshot.lifecycle).toBe('done');
    expect(snapshot.attempts).toEqual({ 'audit-only': 2 });
  });

  it('refuses a stage list that would skip a security invariant before running anything', async () => {
    const stage = { execute: vi.fn() };
    await expect(
      new FlagshipDeliveryService(stage, memoryCheckpoints(), { update: vi.fn() }).run({
        ...flagshipDeliveryRequest(),
        stages: [{ id: 'build', kind: 'implement', acceptanceChecks: ['Compiles'] }],
      }),
    ).rejects.toThrow(/needs a plan stage before it/u);
    expect(stage.execute).not.toHaveBeenCalled();
  });

  it('names the sub-agent task after the stage and gives it the stage checks', async () => {
    const execute = vi.fn(async (task: SubAgentTask) => ({
      taskId: task.taskId,
      status: 'succeeded' as const,
      changedPaths: [],
      tokens: 1,
      toolCalls: 1,
      modelTurns: 1,
      artifacts: ['evidence:audit'],
      findings: [],
    }));
    const adapter = new RuntimeFlagshipStageAdapter({ execute, executeGraph: vi.fn() }, () => ({
      account: 1,
      workspace: 2,
      target: 3,
      policy: 4,
    }));
    const request = flagshipRequestSchema.parse({ ...flagshipStageRequest(), stages });
    const result = await adapter.execute(
      'review',
      request,
      flagshipStageSnapshot(),
      new AbortController().signal,
      { id: 'audit-pass', kind: 'review', description: 'Audit auth', acceptanceChecks: ['Cited'] },
    );
    const task = execute.mock.calls[0]?.[0];
    expect(task?.taskId).toBe('flagship-test-0001-audit-pass');
    expect(task?.role).toBe('reviewer');
    expect(task?.acceptanceChecks).toEqual(['Cited', 'Feature tests pass']);
    expect(task?.goal).toContain('Complete only the audit-pass stage');
    expect(task?.goal).toContain('Audit auth');
    expect(result.resolvedClaims).toEqual(['audit-pass did not complete']);
  });
});
