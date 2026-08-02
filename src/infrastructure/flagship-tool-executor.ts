import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { FlagshipSnapshot } from '../core/flagship-delivery';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { FlagshipDeliveryService } from '../services/flagship-delivery-service';
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
    return { structured: { snapshot: await this.flagship.run(input.request, signal) } };
  }
}

export interface FlagshipMemento {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export class VscodeFlagshipCheckpointStore {
  constructor(private readonly state: FlagshipMemento) {}

  async save(snapshot: FlagshipSnapshot): Promise<void> {
    const checkpoints = this.state.get<Record<string, FlagshipSnapshot>>(checkpointKey, {});
    await this.state.update(checkpointKey, { ...checkpoints, [snapshot.deliveryId]: snapshot });
  }
}
