import type { LifecycleHookPort } from './lifecycle-hook.types';
import type { RuntimeToolExecutorPort, RuntimeToolPolicyPort } from './runtime-tool-dispatcher';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type {
  RunBudget,
  ToolDefinition,
  ToolInvocation,
  ToolResult,
} from '../core/runtime/runtime-tool-contracts';

export interface RuntimeRunStart {
  readonly budget: RunBudget;
  readonly definitions: readonly ToolDefinition[];
  readonly epochs: ToolInvocation['epochs'];
  readonly runId: string;
  readonly turnId: string;
  readonly threadId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly manifestHash: string;
  readonly toolCatalogHash: string;
  readonly provider: string;
  readonly model: string;
}

export interface RuntimeRunStartReceipt {
  readonly runId: string;
}

export interface RuntimeRunTransportPort {
  cancel(runId: string): Promise<void>;
  release?(runId: string): Promise<void>;
  start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt>;
  submitResult(runId: string, result: ToolResult, signal: AbortSignal): Promise<void>;
}

export interface RuntimeEventSink {
  /** Makes the complete batch visible atomically, or throws with zero events published. */
  publishBatch(events: readonly RuntimeEvent[]): void;
}

export interface RuntimeClock {
  now(): number;
}

export interface RuntimeRunServiceDependencies {
  readonly clock: RuntimeClock;
  readonly currentEpochs: () => ToolInvocation['epochs'];
  readonly eventSink: RuntimeEventSink;
  readonly executor: RuntimeToolExecutorPort;
  readonly policy: RuntimeToolPolicyPort;
  /** Optional: a run with no configured hooks pays for nothing. */
  readonly hooks?: LifecycleHookPort;
  readonly receiptId: () => string;
  readonly transport: RuntimeRunTransportPort;
}
