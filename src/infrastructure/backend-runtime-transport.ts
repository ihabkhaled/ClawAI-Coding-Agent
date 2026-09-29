import { createHash } from 'node:crypto';

import { BackendRequestError } from '../backend/backend-errors';
import {
  deferRuntimeCatalog,
  searchDeferredTools,
  withoutSearch,
} from '../core/runtime/runtime-deferred-tools';

import type { BackendClient } from '../backend/backend-client';
import type {
  RuntimeCommandBinding,
  RuntimeStartAck,
  RuntimeStartRequest,
} from '../backend/backend-client.types';
import type {
  DeferredToolSearchOutcome,
  WireToolDefinition,
} from '../core/runtime/runtime-deferred-tools.types';
import type { SteeringMessage } from '../core/runtime/runtime-steering-queue';
import type { ToolDefinition, ToolResult } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeRunStart,
  RuntimeRunStartReceipt,
  RuntimeRunTransportPort,
} from '../services/runtime-run-service';

export class BackendRuntimeTransport implements RuntimeRunTransportPort {
  private readonly bindings = new Map<string, RuntimeCommandBinding>();
  private readonly deferred = new Map<string, { pending: readonly ToolDefinition[] }>();

  constructor(
    private readonly backend: () => BackendRuntimeTransportClient,
    private readonly store: RuntimeBindingStorePort,
  ) {}

  async openStream(runId: string, after: number, signal: AbortSignal): Promise<Response> {
    return this.backend().openRuntimeStream(await this.requireBinding(runId), after, signal);
  }

  async start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt> {
    const { acknowledgement, deferred } = await this.startWithDeferral(input);
    const binding: RuntimeCommandBinding = {
      threadId: input.threadId,
      runId: acknowledgement.runId,
      generation: acknowledgement.generation,
      epochs: input.epochs,
    };
    this.bindings.set(acknowledgement.runId, binding);
    this.deferred.set(acknowledgement.runId, { pending: deferred });
    try {
      await this.store.save(binding);
    } catch (error) {
      this.bindings.delete(acknowledgement.runId);
      try {
        await this.backend().cancelRuntime(binding, `cancel:${acknowledgement.runId}:binding-save`);
      } catch {
        // Preserve the binding persistence failure after best-effort remote compensation.
      }
      throw error;
    }
    return { runId: acknowledgement.runId };
  }

  /**
   * F028: loads the deferred tools a search matched into the running run.
   *
   * Only tools this run declared deferred at start can be loaded; the backend
   * re-checks each against the hash committed then. A run resumed after an
   * editor reload has lost the pending set, and says so rather than guessing.
   */
  async loadDeferredTools(
    runId: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<DeferredToolSearchOutcome> {
    const state = this.deferred.get(runId);
    if (state === undefined) {
      throw new Error('Deferred tools are unavailable for this run; start a new run to use them');
    }
    const matched = searchDeferredTools(query, state.pending);
    if (matched.length === 0) {
      return { loaded: [], available: state.pending.map((definition) => definition.name) };
    }
    const client = this.backend();
    if (client.loadRuntimeTools === undefined) throw new Error('Deferred tool loading unavailable');
    const ack = await client.loadRuntimeTools(await this.requireBinding(runId), matched, signal);
    const loadedNames = new Set(ack.loaded.map((entry) => entry.name));
    state.pending = state.pending.filter((definition) => !loadedNames.has(definition.name));
    return {
      loaded: matched.map((definition) => ({
        name: definition.name,
        version: definition.version,
        description: definition.description,
      })),
      available: state.pending.map((definition) => definition.name),
      catalogVersion: ack.catalogVersion,
    };
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
    this.deferred.delete(runId);
    await this.store.delete(runId);
  }

  async release(runId: string): Promise<void> {
    this.bindings.delete(runId);
    this.deferred.delete(runId);
    await this.store.delete(runId);
  }

  /**
   * Starts with deferred stubs, and falls back to the whole catalog once if a
   * backend that predates F028 rejects the `deferred` field as invalid (400).
   * A validation failure stores nothing, so retrying the same idempotency key
   * is safe.
   */
  private async startWithDeferral(
    input: RuntimeRunStart,
  ): Promise<{ acknowledgement: RuntimeStartAck; deferred: readonly ToolDefinition[] }> {
    const catalog = deferRuntimeCatalog(input.definitions);
    try {
      return {
        acknowledgement: await this.backend().startRuntime(startRequest(input, catalog.wire)),
        deferred: catalog.deferred,
      };
    } catch (error: unknown) {
      if (catalog.deferred.length === 0 || !isValidationRejection(error)) throw error;
      const whole = withoutSearch(input.definitions);
      return {
        acknowledgement: await this.backend().startRuntime(startRequest(input, whole)),
        deferred: [],
      };
    }
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
> &
  // Optional so a client without F028 support is still a transport client; a
  // run can then only ever have an empty deferred set.
  Partial<Pick<BackendClient, 'loadRuntimeTools'>>;

export interface RuntimeBindingStorePort {
  load(runId: string): Promise<RuntimeCommandBinding | undefined>;
  save(binding: RuntimeCommandBinding): Promise<void>;
  delete(runId: string): Promise<void>;
}

function startRequest(
  input: RuntimeRunStart,
  definitions: readonly WireToolDefinition[],
): RuntimeStartRequest {
  return {
    schemaVersion: '2.0',
    threadId: input.threadId,
    clientRequestId: input.clientRequestId,
    idempotencyKey: input.idempotencyKey,
    prompt: input.prompt,
    manifestHash: input.manifestHash,
    // Hashed here, over exactly what is sent: the backend checks this against
    // JSON.stringify of the catalog it received, stubs included.
    toolCatalogHash: `sha256:${createHash('sha256').update(JSON.stringify(definitions)).digest('hex')}`,
    toolDefinitions: definitions,
    provider: input.provider,
    model: input.model,
    epochs: input.epochs,
    budget: input.budget,
  };
}

function isValidationRejection(error: unknown): boolean {
  return error instanceof BackendRequestError && error.status === 400;
}
