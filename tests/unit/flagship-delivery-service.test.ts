import { describe, expect, it, vi } from 'vitest';

import { FlagshipDeliveryService } from '../../src/services/flagship-delivery-service';
import { flagshipDeliveryRequest } from '../helpers/flagship-stage';

import type { FlagshipSnapshot, FlagshipStage } from '../../src/core/flagship-delivery';

const request = flagshipDeliveryRequest();

describe('FlagshipDeliveryService', () => {
  it('runs the complete bounded sequence while effect policy remains host-owned', async () => {
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [`evidence:${current}`],
          unverifiedClaims: [],
        };
      }),
    };
    const checkpoints = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const observer = { update: vi.fn() };

    const snapshot = await new FlagshipDeliveryService(stage, checkpoints, observer).run(request);

    expect(snapshot.lifecycle).toBe('done');
    expect(executed).toEqual([
      'discover',
      'plan',
      'authorize',
      'implement',
      'integrate',
      'verify',
      'review',
      'commit',
      'publish-ready',
      'report',
    ]);
    expect(snapshot.evidenceReferences).toContain('evidence:report');
    expect(checkpoints.save).toHaveBeenCalled();
    expect(snapshot.graphHash).toBe('');
    expect(snapshot.taskAttemptHistory).toEqual([]);
  });

  it('retries a recoverable stage within its explicit attempt budget', async () => {
    let discoverAttempts = 0;
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'discover' && discoverAttempts++ === 0) {
          return {
            status: 'recoverable-failure' as const,
            summary: 'Temporary model failure',
            evidenceReferences: [],
            unverifiedClaims: ['Discovery incomplete'],
            failureClass: 'model' as const,
          };
        }
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [`evidence:${current}`],
          unverifiedClaims: [],
          resolvedClaims: current === 'discover' ? ['Discovery incomplete'] : [],
        };
      }),
    };

    const snapshot = await new FlagshipDeliveryService(
      stage,
      {
        save: async () => undefined,
        load: async () => undefined,
        remove: async () => undefined,
      },
      { update: () => undefined },
    ).run(request);

    expect(snapshot.attempts.discover).toBe(2);
    expect(snapshot.lifecycle).toBe('done');
    expect(snapshot.unverifiedClaims).not.toContain('Discovery incomplete');
  });

  it('persists a plan stage graph into the snapshot and hands it to the implementation stage', async () => {
    const graph = {
      graphId: 'flagship-test-0001-graph',
      parentRunId: request.runId,
      maxConcurrency: 2,
      tasks: [
        {
          taskId: 'implement-feature',
          role: 'implementer' as const,
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
          worktreeId: 'flagship-feature',
          budget: { maxTokens: 1_000, maxToolCalls: 10, maxRuntimeMs: 10_000, maxRetries: 0 },
          tools: ['workspace.files'],
          riskCeiling: 'R3' as const,
          acceptanceChecks: ['Feature tests pass'],
          epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
        },
      ],
    };
    const implementSnapshots: FlagshipSnapshot[] = [];
    const checkpoints = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const stage = {
      execute: vi.fn(async (current: FlagshipStage, _req, snapshot: FlagshipSnapshot) => {
        if (current === 'implement') implementSnapshots.push(snapshot);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
          ...(current === 'plan' ? { graph } : {}),
        };
      }),
    };

    const snapshot = await new FlagshipDeliveryService(stage, checkpoints, {
      update: () => undefined,
    }).run(request);

    expect(snapshot.graph).toEqual(graph);
    expect(implementSnapshots).toHaveLength(1);
    expect(implementSnapshots[0]?.graph).toEqual(graph);
  });
});
