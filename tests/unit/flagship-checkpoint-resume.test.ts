import { describe, expect, it, vi } from 'vitest';

import { flagshipSnapshotSchema } from '../../src/core/flagship-delivery';
import { FlagshipDeliveryService } from '../../src/services/flagship-delivery-service';
import { flagshipDeliveryRequest, liveReconciler } from '../helpers/flagship-stage';

import type { FlagshipSnapshot, FlagshipStage } from '../../src/core/flagship-delivery';

const request = flagshipDeliveryRequest();

describe('FlagshipDeliveryService checkpoints', () => {
  it('starts fresh rather than replaying an incomplete stage from a failed checkpoint', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    const firstExecution: FlagshipStage[] = [];
    const interruptedStage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        firstExecution.push(current);
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    const first = await new FlagshipDeliveryService(interruptedStage, checkpoints, {
      update: () => undefined,
    }).run(request);
    const resumedExecution: FlagshipStage[] = [];
    const resumedStage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        resumedExecution.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    const resumed = await new FlagshipDeliveryService(resumedStage, checkpoints, {
      update: () => undefined,
    }).run(request);

    expect(first.lifecycle).toBe('failed');
    expect(firstExecution).toEqual(['discover', 'plan']);
    expect(checkpoints.load).toHaveBeenCalledWith(request.deliveryId);
    expect(resumed.lifecycle).toBe('done');
    expect(resumedExecution[0]).toBe('discover');
  });

  it('resumes a reconciled paused checkpoint after the last completed stage', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(interrupted, checkpoints, {
      update: () => undefined,
    }).run(request);
    snapshots.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      reconciliation: 'required',
      nextStage: 'plan',
    });
    const reconciler = {
      hostIdentityHash: () => '',
      hostInstanceId: () => 'host-instance-1',
      reconcile: vi.fn(async () => true),
    };
    const resumedExecution: FlagshipStage[] = [];
    const resumed = {
      execute: vi.fn(async (current: FlagshipStage) => {
        resumedExecution.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    await new FlagshipDeliveryService(
      resumed,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run(request);

    expect(reconciler.reconcile).toHaveBeenCalledOnce();
    expect(resumedExecution[0]).toBe('plan');
    expect(resumedExecution).not.toContain('discover');
  });

  it('resumes matching durable identity after restart resets current epochs', async () => {
    const savedEpochs = { account: 1, workspace: 2, target: 3, policy: 4 };
    const resetEpochs = { account: 0, workspace: 0, target: 0, policy: 0 };
    const persisted = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        persisted.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => persisted.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        persisted.delete(deliveryId);
      }),
    };
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const previousHost = {
      hostIdentityHash: () => 'sha256:durable-host',
      hostInstanceId: () => 'host-instance-before-restart',
      reconcile: vi.fn(async () => false),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(
      interrupted,
      checkpoints,
      { update: () => undefined },
      previousHost,
    ).run({ ...request, epochs: savedEpochs });
    persisted.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      reconciliation: 'required',
      nextStage: 'plan',
    });
    const restartedHost = {
      hostIdentityHash: () => 'sha256:durable-host',
      hostInstanceId: () => 'host-instance-after-restart',
      reconcile: vi.fn(async () => true),
    };
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    const resumed = await new FlagshipDeliveryService(
      stage,
      checkpoints,
      { update: () => undefined },
      restartedHost,
    ).run(request, undefined, resetEpochs);

    expect(restartedHost.reconcile).toHaveBeenCalledOnce();
    expect(executed[0]).toBe('plan');
    expect(executed).not.toContain('discover');
    expect(resumed.epochs).toEqual(resetEpochs);
    expect(resumed.hostInstanceId).toBe('host-instance-after-restart');
  });

  it('starts fresh when a paused checkpoint awaits reconciliation', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(interrupted, checkpoints, {
      update: () => undefined,
    }).run(request);
    snapshots.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      reconciliation: 'required',
      nextStage: 'plan',
    });
    const reconciler = {
      hostIdentityHash: () => '',
      hostInstanceId: () => 'host-instance-1',
      reconcile: vi.fn(async () => false),
    };
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    await new FlagshipDeliveryService(
      stage,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run(request);

    expect(reconciler.reconcile).toHaveBeenCalledOnce();
    expect(executed[0]).toBe('discover');
  });

  it('does not resume a checkpoint after the request identity changes', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
    const reconciler = liveReconciler(() => epochs);
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(
      interrupted,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({ ...request, epochs });
    snapshots.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      nextStage: 'plan',
    });
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    await new FlagshipDeliveryService(
      stage,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({
      ...request,
      goal: 'A different delivery request must not reuse saved mutations.',
      epochs,
    });

    expect(checkpoints.load).toHaveBeenCalledWith(request.deliveryId);
    expect(executed[0]).toBe('discover');
  });

  it('resumes an interrupted checkpoint when the identity is unchanged', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    const epochs = { account: 1, workspace: 2, target: 3, policy: 4 };
    const reconciler = liveReconciler(() => epochs);
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(
      interrupted,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({ ...request, epochs });
    snapshots.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      nextStage: 'plan',
    });
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    await new FlagshipDeliveryService(
      stage,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({ ...request, epochs });

    expect(executed[0]).toBe('plan');
  });

  it('does not resume a checkpoint after the policy epoch changes', async () => {
    const snapshots = new Map<string, FlagshipSnapshot>();
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        snapshots.set(snapshot.deliveryId, snapshot);
      }),
      load: vi.fn(async (deliveryId: string) => snapshots.get(deliveryId)),
      remove: vi.fn(async (deliveryId: string) => {
        snapshots.delete(deliveryId);
      }),
    };
    let liveEpochs = { account: 1, workspace: 2, target: 3, policy: 4 };
    const reconciler = liveReconciler(() => liveEpochs);
    const interrupted = {
      execute: vi.fn(async (current: FlagshipStage) => {
        if (current === 'plan') throw new Error('Extension host restarted');
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };
    const interruptedSnapshot = await new FlagshipDeliveryService(
      interrupted,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({ ...request, epochs: liveEpochs });
    snapshots.set(request.deliveryId, {
      ...interruptedSnapshot,
      lifecycle: 'paused',
      nextStage: 'plan',
    });
    const executed: FlagshipStage[] = [];
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => {
        executed.push(current);
        return {
          status: 'succeeded' as const,
          summary: `${current} complete`,
          evidenceReferences: [],
          unverifiedClaims: [],
        };
      }),
    };

    liveEpochs = { account: 1, workspace: 2, target: 3, policy: 5 };
    await new FlagshipDeliveryService(
      stage,
      checkpoints,
      { update: () => undefined },
      reconciler,
    ).run({ ...request, epochs: liveEpochs });

    expect(executed[0]).toBe('discover');
  });

  it('removes the checkpoint after a completed delivery', async () => {
    const checkpoints = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => ({
        status: 'succeeded' as const,
        summary: `${current} complete`,
        evidenceReferences: [],
        unverifiedClaims: [],
      })),
    };

    const snapshot = await new FlagshipDeliveryService(stage, checkpoints, {
      update: () => undefined,
    }).run(request);

    expect(snapshot.lifecycle).toBe('done');
    expect(checkpoints.remove).toHaveBeenCalledWith(request.deliveryId);
  });

  it('removes the checkpoint when a stage blocks the delivery', async () => {
    const checkpoints = {
      save: vi.fn(async () => undefined),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => ({
        status: current === 'plan' ? ('blocked' as const) : ('succeeded' as const),
        summary: `${current} complete`,
        evidenceReferences: [],
        unverifiedClaims: [],
      })),
    };

    const snapshot = await new FlagshipDeliveryService(stage, checkpoints, {
      update: () => undefined,
    }).run(request);

    expect(snapshot.lifecycle).toBe('blocked');
    expect(checkpoints.remove).toHaveBeenCalledWith(request.deliveryId);
  });

  it('keeps a persistable stop reason when a stage reports an oversized summary', async () => {
    const saved: FlagshipSnapshot[] = [];
    const checkpoints = {
      save: vi.fn(async (snapshot: FlagshipSnapshot) => {
        saved.push(snapshot);
      }),
      load: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const stage = {
      execute: vi.fn(async (current: FlagshipStage) => ({
        status: current === 'plan' ? ('blocked' as const) : ('succeeded' as const),
        summary: current === 'plan' ? 'x'.repeat(30_000) : `${current} complete`,
        evidenceReferences: [],
        unverifiedClaims: [],
      })),
    };

    const snapshot = await new FlagshipDeliveryService(stage, checkpoints, {
      update: () => undefined,
    }).run(request);

    expect(snapshot.stopReason).toHaveLength(20_000);
    expect(snapshot.stageSummaries.plan).toHaveLength(20_000);
    expect(saved.every((entry) => flagshipSnapshotSchema.safeParse(entry).success)).toBe(true);
  });
});
