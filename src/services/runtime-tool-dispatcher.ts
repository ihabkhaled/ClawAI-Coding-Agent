import {
  admitRuntimeInvocation,
  createRuntimeInvocationRegistry,
  type RuntimeInvocationRegistry,
} from '../core/runtime/runtime-invocation-registry';
import {
  consumeRuntimeBudget,
  createRuntimeBudgetState,
  type RuntimeBudgetState,
} from '../core/runtime/runtime-run-budget';
import {
  type Continuation,
  type RunBudget,
  type RuntimeJsonObject,
  type ToolDefinition,
  type ToolInvocation,
  type ToolResult,
} from '../core/runtime/runtime-tool-contracts';
import { buildRuntimeToolResult } from '../core/runtime/runtime-tool-result';

export interface RuntimeToolPolicyDecision {
  readonly decision: 'allow' | 'deny';
  readonly code: string;
  readonly message: string;
}

export interface RuntimeToolPolicyPort {
  evaluate(invocation: ToolInvocation): Promise<RuntimeToolPolicyDecision>;
}

export interface RuntimeToolExecutionOutput {
  readonly structured?: RuntimeJsonObject;
  readonly modelText?: string;
}

export interface RuntimeToolExecutorPort {
  execute(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput>;
}

export interface RuntimeToolDispatcherInput {
  readonly runId: string;
  readonly epochs: ToolInvocation['epochs'];
  readonly definitions: readonly ToolDefinition[];
  readonly budget: RunBudget;
  readonly startedAtMs: number;
  readonly currentEpochs: () => ToolInvocation['epochs'];
  readonly policy: RuntimeToolPolicyPort;
  readonly executor: RuntimeToolExecutorPort;
  readonly now: () => number;
  readonly receiptId: () => string;
}

export interface RuntimeToolDispatcherSnapshot {
  readonly registry: RuntimeInvocationRegistry;
  readonly budget: RuntimeBudgetState;
  readonly results: Readonly<Record<string, ToolResult>>;
}

function epochsMatch(left: ToolInvocation['epochs'], right: ToolInvocation['epochs']): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

export class RuntimeToolDispatcher {
  private state: RuntimeToolDispatcherSnapshot;

  constructor(private readonly input: RuntimeToolDispatcherInput) {
    this.state = {
      registry: createRuntimeInvocationRegistry({
        runId: input.runId,
        epochs: input.epochs,
        definitions: input.definitions,
      }),
      budget: createRuntimeBudgetState(input.budget, input.startedAtMs),
      results: {},
    };
  }

  get snapshot(): RuntimeToolDispatcherSnapshot {
    return this.state;
  }

  async dispatch(
    value: unknown,
    continuation: Continuation,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    signal?.throwIfAborted();
    this.assertCurrentEpochs();
    const admission = admitRuntimeInvocation(this.state.registry, value);
    if (admission.replayed) {
      const completed = this.state.results[admission.invocation.invocationId];
      if (completed === undefined) {
        throw new Error('Runtime invocation is already in progress');
      }
      return completed;
    }

    const startedAtMs = this.input.now();
    this.state = {
      ...this.state,
      registry: admission.registry,
      budget: consumeRuntimeBudget(this.state.budget, { toolCalls: 1, toolRounds: 1 }, startedAtMs),
    };
    const decision = await this.input.policy.evaluate(admission.invocation);
    signal?.throwIfAborted();
    this.assertCurrentEpochs();
    if (decision.decision === 'deny') {
      return this.complete(admission.invocation, startedAtMs, continuation, {
        status: 'denied',
        error: {
          code: decision.code,
          message: decision.message,
          retryable: false,
          redactionApplied: true,
        },
      });
    }

    try {
      const output = await this.input.executor.execute(admission.invocation, signal);
      signal?.throwIfAborted();
      this.assertCurrentEpochs();
      return this.complete(admission.invocation, startedAtMs, continuation, {
        status: 'succeeded',
        ...output,
      });
    } catch {
      signal?.throwIfAborted();
      this.assertCurrentEpochs();
      return this.complete(admission.invocation, startedAtMs, continuation, {
        status: 'failed',
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'The trusted tool executor failed.',
          retryable: false,
          redactionApplied: true,
        },
      });
    }
  }

  private assertCurrentEpochs(): void {
    if (!epochsMatch(this.input.epochs, this.input.currentEpochs())) {
      throw new Error('Runtime tool dispatcher epochs are stale');
    }
  }

  private complete(
    invocation: ToolInvocation,
    startedAtMs: number,
    continuation: Continuation,
    outcome: RuntimeToolExecutionOutput & {
      readonly status: ToolResult['status'];
      readonly error?: ToolResult['error'];
    },
  ): ToolResult {
    const completedAtMs = this.input.now();
    const result = buildRuntimeToolResult({
      invocation,
      receiptId: this.input.receiptId(),
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      continuation,
      maxOutputBytes: this.state.budget.budget.maxToolResultBytes,
      status: outcome.status,
      ...(outcome.structured === undefined ? {} : { structured: outcome.structured }),
      ...(outcome.modelText === undefined ? {} : { modelText: outcome.modelText }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    });
    const budget = consumeRuntimeBudget(
      this.state.budget,
      {
        outputBytes: result.receipt.outputBytes,
        toolResultBytes: result.receipt.outputBytes,
      },
      completedAtMs,
    );
    this.state = {
      ...this.state,
      budget,
      results: { ...this.state.results, [invocation.invocationId]: result },
    };
    return result;
  }
}
