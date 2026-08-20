import { describe, expect, it } from 'vitest';

import {
  flagshipHostIdentityHash,
  type FlagshipHostIdentity,
  type FlagshipRequest,
  type FlagshipSnapshot,
} from '../../src/core/flagship-delivery';
import {
  VscodeFlagshipCheckpointReconciler,
  VscodeFlagshipCheckpointStore,
} from '../../src/infrastructure/flagship-tool-executor';

const hostIdentity: FlagshipHostIdentity = {
  accountId: 'account-1',
  workspaceId: 'workspace-root',
  workspaceRoot: 'file:///workspace-root',
  targetIdentity: 'target-manifest-1',
  policyIdentity: 'https://claw.local|ASK|trusted',
};
import type { FlagshipMemento } from '../../src/infrastructure/flagship-tool-executor';

const snapshot: FlagshipSnapshot = {
  deliveryId: 'flagship-test-0001',
  runId: 'runtime-flagship-test',
  requestHash: 'sha256:1234',
  hostIdentityHash: flagshipHostIdentityHash(hostIdentity),
  hostInstanceId: 'host-instance-1',
  epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  stage: 'plan',
  nextStage: 'plan',
  lifecycle: 'paused',
  reconciliation: 'verified',
  attempts: { discover: 1 },
  evidenceReferences: [],
  unverifiedClaims: [],
  steering: [],
  stageSummaries: { discover: 'complete' },
  usage: { modelTurns: 0, toolCalls: 0, subAgents: 0 },
  commits: [],
  graphHash: '',
  taskOutcomes: [],
  taskAttemptHistory: [],
  recoveryHistory: [],
  acceptanceReceipts: [],
  startedAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

const request: FlagshipRequest = {
  deliveryId: snapshot.deliveryId,
  runId: snapshot.runId,
  goal: 'Resume verified work only after host reconciliation.',
  strategy: 'cross-stack-feature',
  repositories: ['workspace-root'],
  writeSet: [],
  acceptanceChecks: [],
  mandatoryGateIds: [],
  epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  budget: {
    maxRuntimeMs: 60_000,
    maxStageAttempts: 2,
    maxModelTurns: 20,
    maxToolCalls: 100,
    maxSubAgents: 20,
  },
};

class MemoryMemento implements FlagshipMemento {
  private value: unknown;

  get<T>(_key: string, fallback: T): T {
    return this.value === undefined ? fallback : (this.value as T);
  }

  update(_key: string, value: unknown): Thenable<void> {
    this.value = value;
    return Promise.resolve();
  }
}

describe('VscodeFlagshipCheckpointStore', () => {
  it('persists, loads, and removes a validated checkpoint', async () => {
    const store = new VscodeFlagshipCheckpointStore(new MemoryMemento());

    await store.save(snapshot);

    expect(await store.load(snapshot.deliveryId)).toEqual(snapshot);

    await store.remove(snapshot.deliveryId);

    expect(await store.load(snapshot.deliveryId)).toBeUndefined();
  });

  it('rejects a malformed persisted checkpoint', async () => {
    const store = new VscodeFlagshipCheckpointStore({
      get: <T>(_key: string, _fallback: T) => ({ [snapshot.deliveryId]: { malformed: true } }) as T,
      update: () => Promise.resolve(),
    });

    expect(await store.load(snapshot.deliveryId)).toBeUndefined();
  });

  it('rejects resume when the durable host identity changes', async () => {
    const reconciler = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => request.epochs,
      () => flagshipHostIdentityHash(hostIdentity),
      'host-instance-1',
    );
    const changedAccount = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => request.epochs,
      () =>
        flagshipHostIdentityHash({
          ...hostIdentity,
          accountId: 'account-2',
        }),
      'host-instance-1',
    );
    const changedWorkspace = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => request.epochs,
      () =>
        flagshipHostIdentityHash({
          ...hostIdentity,
          workspaceRoot: 'file:///workspace-changed',
        }),
      'host-instance-1',
    );
    const changedTarget = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => request.epochs,
      () =>
        flagshipHostIdentityHash({
          ...hostIdentity,
          targetIdentity: 'target-manifest-2',
        }),
      'host-instance-1',
    );
    const changedPolicy = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => request.epochs,
      () =>
        flagshipHostIdentityHash({
          ...hostIdentity,
          policyIdentity: 'https://claw.local|AUTO_EDIT|trusted',
        }),
      'host-instance-1',
    );

    expect(await reconciler.reconcile(snapshot, request)).toBe(true);
    expect(await changedAccount.reconcile(snapshot, request)).toBe(false);
    expect(await changedWorkspace.reconcile(snapshot, request)).toBe(false);
    expect(await changedTarget.reconcile(snapshot, request)).toBe(false);
    expect(await changedPolicy.reconcile(snapshot, request)).toBe(false);
  });

  it('accepts reset epochs only after a host process restart', async () => {
    const resetEpochs = { account: 0, workspace: 0, target: 0, policy: 0 };
    const reconciler = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => resetEpochs,
      () => flagshipHostIdentityHash(hostIdentity),
      'host-instance-2',
    );

    expect(await reconciler.reconcile(snapshot, { ...request, epochs: resetEpochs })).toBe(true);
  });

  it('rejects an epoch change within the same host process', async () => {
    let currentEpochs = request.epochs;
    const reconciler = new VscodeFlagshipCheckpointReconciler(
      () => 'workspace-root',
      () => currentEpochs,
      () => flagshipHostIdentityHash(hostIdentity),
      'host-instance-1',
    );
    currentEpochs = { ...currentEpochs, policy: currentEpochs.policy + 1 };

    expect(await reconciler.reconcile(snapshot, request)).toBe(false);
  });
});
