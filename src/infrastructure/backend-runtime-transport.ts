import type { BackendClient } from '../backend/backend-client';
import type { RuntimeCommandBinding } from '../backend/backend-client.types';
import type { ToolResult } from '../core/runtime/runtime-tool-contracts';
import type { SteeringMessage } from '../core/runtime/runtime-steering-queue';
import type {
  RuntimeRunStart,
  RuntimeRunStartReceipt,
  RuntimeRunTransportPort,
} from '../services/runtime-run-service';

export class BackendRuntimeTransport implements RuntimeRunTransportPort {
  private readonly bindings = new Map<string, RuntimeCommandBinding>();

  constructor(
    private readonly backend: () => BackendRuntimeTransportClient,
    private readonly store: RuntimeBindingStorePort,
  ) {}

  async openStream(runId: string, after: number, signal: AbortSignal): Promise<Response> {
    return this.backend().openRuntimeStream(await this.requireBinding(runId), after, signal);
  }

  async start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt> {
    const acknowledgement = await this.backend().startRuntime({
      schemaVersion: '2.0',
      threadId: input.threadId,
      clientRequestId: input.clientRequestId,
      idempotencyKey: input.idempotencyKey,
      prompt: input.prompt,
      manifestHash: input.manifestHash,
      toolCatalogHash: input.toolCatalogHash,
      toolDefinitions: input.definitions,
      provider: input.provider,
      model: input.model,
      epochs: input.epochs,
      budget: input.budget,
    });
    const binding: RuntimeCommandBinding = {
      threadId: input.threadId,
      runId: acknowledgement.runId,
      generation: acknowledgement.generation,
      epochs: input.epochs,
    };
    this.bindings.set(acknowledgement.runId, binding);
    await this.store.save(binding);
    return { runId: acknowledgement.runId };
  }

  async submitResult(runId: string, result: ToolResult, signal: AbortSignal): Promise<void> {
    const binding = await this.requireBinding(runId);
    await this.backend().submitRuntimeResult(
      binding,
      `${result.receipt.receiptId}:result`,
      result,
      signal,
    );
  }

  async steer(runId: string, steering: SteeringMessage, signal: AbortSignal): Promise<void> {
    await this.backend().steerRuntime(await this.requireBinding(runId), steering, signal);
  }

  async cancel(runId: string): Promise<void> {
    const binding = await this.requireBinding(runId);
    await this.backend().cancelRuntime(binding, `cancel:${runId}`);
    this.bindings.delete(runId);
    await this.store.delete(runId);
  }

  private async requireBinding(runId: string): Promise<RuntimeCommandBinding> {
    const binding = this.bindings.get(runId) ?? (await this.store.load(runId));
    if (binding === undefined) throw new Error('Runtime transport has no binding for this run');
    this.bindings.set(runId, binding);
    return binding;
  }
}

export type BackendRuntimeTransportClient = Pick<
  BackendClient,
  'cancelRuntime' | 'openRuntimeStream' | 'startRuntime' | 'steerRuntime' | 'submitRuntimeResult'
>;

export interface RuntimeBindingStorePort {
  load(runId: string): Promise<RuntimeCommandBinding | undefined>;
  save(binding: RuntimeCommandBinding): Promise<void>;
  delete(runId: string): Promise<void>;
}
