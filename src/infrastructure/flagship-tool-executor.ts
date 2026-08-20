import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  flagshipSnapshotSchema,
  type FlagshipRequest,
  type FlagshipSnapshot,
} from '../core/flagship-delivery';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  FlagshipCheckpointReconcilerPort,
  FlagshipDeliveryService,
} from '../services/flagship-delivery-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const inputSchema = z.object({ request: z.unknown() }).strict();
const checkpointKey = 'clawai.runtime.flagship.checkpoints';

export const flagshipToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.flagship',
  version: '2.0.0',
  description:
    'Execute a bounded evidence-first delivery through discovery, planning, implementation, integration, verification, review, and reporting.',
  operations: ['run'],
  riskClasses: ['inspect', 'workspace-write', 'process', 'git-mutate'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.flagship,
};

export class FlagshipToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly flagship: FlagshipDeliveryService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== flagshipToolDefinition.name || invocation.operation !== 'run')
      throw new Error('Unknown flagship operation');
    const input = inputSchema.parse(invocation.arguments);
    return {
      structured: { snapshot: await this.flagship.run(input.request, signal, invocation.epochs) },
    };
  }
}

export interface FlagshipMemento {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export class VscodeFlagshipCheckpointStore {
  constructor(private readonly state: FlagshipMemento) {}

  async save(snapshot: FlagshipSnapshot): Promise<void> {
    const checkpoints = this.checkpoints();
    const validated = flagshipSnapshotSchema.parse(snapshot);
    await this.state.update(checkpointKey, { ...checkpoints, [validated.deliveryId]: validated });
  }

  load(deliveryId: string): Promise<FlagshipSnapshot | undefined> {
    return Promise.resolve(this.checkpoints()[deliveryId]);
  }

  async remove(deliveryId: string): Promise<void> {
    const checkpoints = this.checkpoints();
    const remaining = Object.fromEntries(
      Object.entries(checkpoints).filter(([checkpointId]) => checkpointId !== deliveryId),
    );
    await this.state.update(checkpointKey, remaining);
  }

  // Parsed per entry: one corrupt checkpoint must not discard every other
  // delivery's resumable state on the next save.
  private checkpoints(): Record<string, FlagshipSnapshot> {
    const candidate = this.state.get<unknown>(checkpointKey, {});
    const record = z.record(z.string(), z.unknown()).safeParse(candidate);
    if (!record.success) return {};
    const checkpoints: Record<string, FlagshipSnapshot> = {};
    for (const [deliveryId, entry] of Object.entries(record.data)) {
      const snapshot = flagshipSnapshotSchema.safeParse(entry);
      if (snapshot.success) checkpoints[deliveryId] = snapshot.data;
    }
    return checkpoints;
  }
}

export class VscodeFlagshipCheckpointReconciler implements FlagshipCheckpointReconcilerPort {
  constructor(
    private readonly workspaceId: () => string,
    private readonly epochs: () => FlagshipSnapshot['epochs'],
    private readonly identityHash: () => string,
    private readonly instanceId: string = randomUUID(),
  ) {}

  hostIdentityHash(): string {
    return this.identityHash();
  }

  hostInstanceId(): string {
    return this.instanceId;
  }

  reconcile(checkpoint: FlagshipSnapshot, request: FlagshipRequest): Promise<boolean> {
    return Promise.resolve(
      request.repositories.includes(this.workspaceId()) &&
        checkpoint.hostIdentityHash === this.hostIdentityHash() &&
        checkpoint.hostInstanceId !== undefined &&
        (checkpoint.hostInstanceId !== this.hostInstanceId() || this.epochsMatch(checkpoint)),
    );
  }

  private epochsMatch(checkpoint: FlagshipSnapshot): boolean {
    const epochs = this.epochs();
    return (
      checkpoint.epochs?.account === epochs?.account &&
      checkpoint.epochs?.workspace === epochs?.workspace &&
      checkpoint.epochs?.target === epochs?.target &&
      checkpoint.epochs?.policy === epochs?.policy
    );
  }
}
