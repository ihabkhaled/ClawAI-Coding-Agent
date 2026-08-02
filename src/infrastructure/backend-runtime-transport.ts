import type { BackendClient } from '../backend/backend-client';
import type { RuntimeCommandBinding } from '../backend/backend-client.types';
import type { ToolResult } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeRunStart,
  RuntimeRunStartReceipt,
  RuntimeRunTransportPort,
} from '../services/runtime-run-service';

export class BackendRuntimeTransport implements RuntimeRunTransportPort {
  private readonly bindings = new Map<string, RuntimeCommandBinding>();

  constructor(private readonly backend: () => BackendClient) {}

  openStream(runId: string, after: number, signal: AbortSignal): Promise<Response> {
    return this.backend().openRuntimeStream(this.requireBinding(runId), after, signal);
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
      provider: input.provider,
      model: input.model,
      epochs: input.epochs,
      budget: input.budget,
    });
    this.bindings.set(acknowledgement.runId, {
      threadId: input.threadId,
      runId: acknowledgement.runId,
      generation: acknowledgement.generation,
      epochs: input.epochs,
    });
    return { runId: acknowledgement.runId };
  }

  async submitResult(runId: string, result: ToolResult, signal: AbortSignal): Promise<void> {
    const binding = this.requireBinding(runId);
    await this.backend().submitRuntimeResult(
      binding,
      `${result.receipt.receiptId}:result`,
      result,
      signal,
    );
  }

  async cancel(runId: string): Promise<void> {
    const binding = this.requireBinding(runId);
    await this.backend().cancelRuntime(binding, `cancel:${runId}`);
    this.bindings.delete(runId);
  }

  binding(runId: string): RuntimeCommandBinding {
    return this.requireBinding(runId);
  }

  private requireBinding(runId: string): RuntimeCommandBinding {
    const binding = this.bindings.get(runId);
    if (binding === undefined) throw new Error('Runtime transport has no binding for this run');
    return binding;
  }
}
