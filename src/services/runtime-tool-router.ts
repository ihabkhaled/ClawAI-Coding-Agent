import type { RuntimePolicyV2Adapter } from './runtime-policy-v2-adapter';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from './runtime-tool-dispatcher';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface RuntimeToolRegistration {
  readonly definition: ToolDefinition;
  readonly executor: RuntimeToolExecutorPort;
}

/**
 * Routes only tools that were registered in the negotiated capability catalog.
 * Approval capabilities are consumed at the last possible moment, immediately
 * before the selected executor can produce an effect.
 */
export class RuntimeToolRouter implements RuntimeToolExecutorPort {
  private readonly registrations: ReadonlyMap<string, RuntimeToolRegistration>;

  constructor(
    registrations: readonly RuntimeToolRegistration[],
    private readonly policy: RuntimePolicyV2Adapter,
  ) {
    const entries = registrations.map(
      (registration) => [registration.definition.name, registration] as const,
    );
    if (new Set(entries.map(([name]) => name)).size !== entries.length) {
      throw new Error('Runtime tool names must be unique');
    }
    this.registrations = new Map(entries);
  }

  definitions(): readonly ToolDefinition[] {
    return [...this.registrations.values()].map(({ definition }) => definition);
  }

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    signal?.throwIfAborted();
    const registration = this.registrations.get(invocation.toolName);
    if (registration === undefined) throw new Error('Runtime tool is not registered');
    if (registration.definition.version !== invocation.toolVersion) {
      throw new Error('Runtime tool version does not match the negotiated catalog');
    }
    if (!registration.definition.operations.includes(invocation.operation)) {
      throw new Error('Runtime tool operation is not registered');
    }
    if (!registration.definition.targetIds.includes(invocation.targetId)) {
      throw new Error('Runtime tool target is not registered');
    }
    this.policy.consumeCapability(invocation);
    signal?.throwIfAborted();
    return registration.executor.execute(invocation, signal);
  }
}
