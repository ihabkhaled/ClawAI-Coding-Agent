import { describe, expect, it, vi } from 'vitest';

import { FlagshipDeliveryService } from '../../src/services/flagship-delivery-service';

import type { FlagshipStage } from '../../src/core/flagship-delivery';

const request = {
  deliveryId: 'flagship-test-0001',
  runId: 'runtime-flagship-test',
  goal: 'Implement and verify a cross-stack feature.',
  strategy: 'cross-stack-feature' as const,
  repositories: ['workspace-root'],
  writeSet: ['src/feature.ts'],
  acceptanceChecks: ['The feature is covered by tests'],
  budget: {
    maxRuntimeMs: 60_000,
    maxStageAttempts: 2,
    maxModelTurns: 20,
    maxToolCalls: 100,
    maxSubAgents: 5,
  },
  effects: {
    commitAuthorized: false,
    pushAuthorized: false,
    deployAuthorized: false,
    publishAuthorized: false,
  },
};

describe('FlagshipDeliveryService', () => {
  it('runs the complete bounded sequence and skips an unauthorized commit', async () => {
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
    const checkpoints = { save: vi.fn(async () => undefined) };
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
      'publish-ready',
      'report',
    ]);
    expect(snapshot.evidenceReferences).toContain('evidence:report');
    expect(checkpoints.save).toHaveBeenCalled();
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
      { save: async () => undefined },
      { update: () => undefined },
    ).run(request);

    expect(snapshot.attempts.discover).toBe(2);
    expect(snapshot.lifecycle).toBe('done');
    expect(snapshot.unverifiedClaims).not.toContain('Discovery incomplete');
  });
});
