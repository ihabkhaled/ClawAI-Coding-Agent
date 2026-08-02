import {
  admitRuntimeInvocation,
  closeRuntimeInvocationRegistry,
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
  evaluate(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolPolicyDecision>;
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
  readonly turnId: string;
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
  readonly lifecycle: 'active' | 'blocked' | 'cancelled' | 'completed' | 'failed';
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
        turnId: input.turnId,
      }),
      budget: createRuntimeBudgetState(input.budget, input.startedAtMs),
      results: {},
      lifecycle: 'active',
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
    if (this.state.lifecycle !== 'active') throw new Error('Runtime tool dispatcher is terminal');

    const startedAtMs = this.input.now();
    const nextBudget = consumeRuntimeBudget(
      this.state.budget,
      {
        modelTurns: 1,
        toolCalls: 1,
        toolRounds: 1,
        repairAttempts: continuation.action === 'repair' ? 1 : 0,
      },
      startedAtMs,
    );
    this.state = {
      ...this.state,
      registry: admission.registry,
      budget: nextBudget,
    };
    const deadline = this.createDeadline(signal);
    try {
      const decision = await this.awaitWithinDeadline(
        this.input.policy.evaluate(admission.invocation, deadline.signal),
        deadline.signal,
      );
      this.assertCurrentEpochs();
      if (decision.decision === 'deny') {
        return this.complete(admission.invocation, startedAtMs, continuation, {
          status: 'denied',
          error: {
            code: decision.code,
            message: decision.message,
            retryable: false,
            redactionApplied: false,
          },
        });
      }
      const output = await this.awaitWithinDeadline(
        this.input.executor.execute(admission.invocation, deadline.signal),
        deadline.signal,
      );
      deadline.signal.throwIfAborted();
      this.assertCurrentEpochs();
      return this.complete(admission.invocation, startedAtMs, continuation, {
        status: 'succeeded',
        ...output,
      });
    } catch {
      const cancelled = deadline.signal.aborted;
      this.assertCurrentEpochs();
      return this.complete(admission.invocation, startedAtMs, continuation, {
        status: cancelled ? 'cancelled' : 'failed',
        error: {
          code: cancelled ? 'TOOL_CANCELLED' : 'TOOL_EXECUTION_FAILED',
          message: cancelled ? 'The tool run was cancelled.' : 'The trusted tool executor failed.',
          retryable: false,
          redactionApplied: false,
        },
      });
    } finally {
      deadline.dispose();
    }
  }

  private createDeadline(signal: AbortSignal | undefined): {
    readonly dispose: () => void;
    readonly signal: AbortSignal;
  } {
    const controller = new AbortController();
    const remaining =
      this.state.budget.budget.maxRuntimeMs - (this.input.now() - this.state.budget.startedAtMs);
    const timer = setTimeout(
      () => {
        controller.abort(new Error('Runtime deadline exceeded'));
      },
      Math.max(0, remaining),
    );
    const abort = () => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      },
    };
  }

  private async awaitWithinDeadline<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) signal.throwIfAborted();
    return Promise.race([
      value,
      new Promise<T>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(signal.reason instanceof Error ? signal.reason : new Error('Runtime cancelled'));
          },
          { once: true },
        );
      }),
    ]);
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
    const lifecycle = this.lifecycleFor(result, continuation);
    this.state = {
      ...this.state,
      budget,
      lifecycle,
      registry:
        lifecycle === 'active'
          ? this.state.registry
          : closeRuntimeInvocationRegistry(this.state.registry, lifecycle),
      results: Object.freeze({ ...this.state.results, [invocation.invocationId]: result }),
    };
    return result;
  }

  private lifecycleFor(
    result: ToolResult,
    continuation: Continuation,
  ): RuntimeToolDispatcherSnapshot['lifecycle'] {
    if (result.status === 'succeeded')
      return continuation.action === 'continue' ? 'active' : 'completed';
    if (result.status === 'denied') return 'blocked';
    if (result.status === 'cancelled') return 'cancelled';
    return 'failed';
  }
}
