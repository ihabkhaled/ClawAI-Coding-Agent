import {
  advanceRuntimeInvocationRegistryTurn,
  admitRuntimeInvocation,
  closeRuntimeInvocationRegistry,
  createRuntimeInvocationRegistry,
  type RuntimeInvocationRegistry,
} from '../core/runtime/runtime-invocation-registry';
import { runtimeJsonObjectSchema } from '../core/runtime/runtime-json-value';
import {
  consumeRuntimeBudget,
  createRuntimeBudgetState,
  type RuntimeBudgetState,
} from '../core/runtime/runtime-run-budget';
import {
  type Continuation,
  type RunBudget,
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
  /** Adapter output is validated into bounded canonical JSON before it enters runtime state. */
  readonly structured?: Readonly<Record<string, unknown>>;
  readonly modelText?: string;
}

export interface RuntimeToolExecutorPort {
  execute(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput>;
}

export interface RuntimeToolDispatchObserver {
  readonly onInvocationAdmitted: (invocation: ToolInvocation, budget: RuntimeBudgetState) => void;
}

export interface RuntimeToolDispatcherInput {
  readonly consumeModelLifecycleBudget?: boolean;
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
  readonly terminalInvocationId: string | undefined;
  readonly lifecycle: 'active' | 'blocked' | 'cancelled' | 'completed' | 'failed';
}

interface RuntimeDeadline {
  readonly abort: (reason?: unknown) => void;
  readonly dispose: () => void;
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
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
  private readonly activeDeadlines = new Map<string, RuntimeDeadline>();
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
      terminalInvocationId: undefined,
      lifecycle: 'active',
    };
  }

  get snapshot(): RuntimeToolDispatcherSnapshot {
    return this.state;
  }

  recordModelLifecycle(repair: boolean, turnId?: string): RuntimeBudgetState {
    const registry =
      turnId === undefined
        ? this.state.registry
        : advanceRuntimeInvocationRegistryTurn(this.state.registry, turnId);
    const budget = consumeRuntimeBudget(
      this.state.budget,
      { modelTurns: 1, repairAttempts: repair ? 1 : 0 },
      this.input.now(),
    );
    this.state = { ...this.state, budget, registry };
    return budget;
  }

  assertWithinBudget(): void {
    consumeRuntimeBudget(this.state.budget, {}, this.input.now());
  }

  async dispatch(
    value: unknown,
    continuation: Continuation,
    signal?: AbortSignal,
    observer?: RuntimeToolDispatchObserver,
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
        toolCalls: 1,
        toolRounds: 1,
        ...(this.input.consumeModelLifecycleBudget === false
          ? {}
          : {
              modelTurns: 1,
              repairAttempts: continuation.action === 'repair' ? 1 : 0,
            }),
      },
      startedAtMs,
    );
    const stateBeforeAdmission = this.state;
    this.state = {
      ...this.state,
      registry: admission.registry,
      budget: nextBudget,
    };
    try {
      observer?.onInvocationAdmitted(admission.invocation, nextBudget);
    } catch (error) {
      this.state = stateBeforeAdmission;
      throw error;
    }
    const deadline = this.createDeadline(signal);
    this.activeDeadlines.set(admission.invocation.invocationId, deadline);
    try {
      let outcome:
        | (RuntimeToolExecutionOutput & {
            readonly status: ToolResult['status'];
            readonly error?: ToolResult['error'];
          })
        | undefined;
      try {
        const decision = await this.awaitWithinDeadline(
          this.input.policy.evaluate(admission.invocation, deadline.signal),
          deadline.signal,
        );
        this.assertCurrentEpochs();
        if (decision.decision === 'deny') {
          outcome = {
            status: 'denied',
            error: {
              code: decision.code,
              message: decision.message,
              retryable: false,
              redactionApplied: false,
            },
          };
        } else {
          const output = await this.awaitWithinDeadline(
            this.input.executor.execute(admission.invocation, deadline.signal),
            deadline.signal,
          );
          deadline.signal.throwIfAborted();
          this.assertCurrentEpochs();
          outcome = { status: 'succeeded', ...output };
        }
      } catch {
        this.assertCurrentEpochs();
        outcome = this.failureOutcome(deadline);
      }
      return this.complete(admission.invocation, startedAtMs, continuation, outcome);
    } finally {
      this.activeDeadlines.delete(admission.invocation.invocationId);
      deadline.dispose();
    }
  }

  private createDeadline(signal: AbortSignal | undefined): RuntimeDeadline {
    const controller = new AbortController();
    let timedOut = false;
    const remaining =
      this.state.budget.budget.maxRuntimeMs - (this.input.now() - this.state.budget.startedAtMs);
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort(new Error('Runtime deadline exceeded'));
      },
      Math.max(0, remaining + 1),
    );
    const abortFromCaller = () => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    return {
      abort: (reason?: unknown) => {
        controller.abort(reason);
      },
      signal: controller.signal,
      timedOut: () => timedOut,
      dispose: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromCaller);
      },
    };
  }

  private failureOutcome(deadline: RuntimeDeadline): {
    readonly error: NonNullable<ToolResult['error']>;
    readonly status: ToolResult['status'];
  } {
    if (deadline.timedOut()) {
      return {
        status: 'timed-out',
        error: {
          code: 'TOOL_TIMED_OUT',
          message: 'The tool run exceeded its runtime deadline.',
          retryable: false,
          redactionApplied: false,
        },
      };
    }
    if (deadline.signal.aborted) {
      return {
        status: 'cancelled',
        error: {
          code: 'TOOL_CANCELLED',
          message: 'The tool run was cancelled.',
          retryable: false,
          redactionApplied: false,
        },
      };
    }
    return {
      status: 'failed',
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'The trusted tool executor failed.',
        retryable: false,
        redactionApplied: false,
      },
    };
  }

  private async awaitWithinDeadline<T>(value: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) signal.throwIfAborted();
    let rejectForAbort: ((reason: Error) => void) | undefined;
    const abortPromise = new Promise<T>((_resolve, reject) => {
      rejectForAbort = reject;
    });
    const onAbort = () => {
      rejectForAbort?.(
        signal.reason instanceof Error ? signal.reason : new Error('Runtime cancelled'),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await Promise.race([value, abortPromise]);
    } finally {
      signal.removeEventListener('abort', onAbort);
      rejectForAbort = undefined;
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
      ...(outcome.structured === undefined
        ? {}
        : { structured: runtimeJsonObjectSchema.parse(outcome.structured) }),
      ...(outcome.modelText === undefined ? {} : { modelText: outcome.modelText }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    });
    const budget = this.consumeResultBudget(result, completedAtMs);
    const lifecycle =
      this.state.lifecycle === 'active'
        ? this.lifecycleFor(result, continuation)
        : this.state.lifecycle;
    this.state = {
      ...this.state,
      budget,
      lifecycle,
      registry:
        lifecycle === 'active' || this.state.registry.status !== 'active'
          ? this.state.registry
          : closeRuntimeInvocationRegistry(this.state.registry, lifecycle),
      results: Object.freeze({ ...this.state.results, [invocation.invocationId]: result }),
      terminalInvocationId:
        this.state.terminalInvocationId ??
        (lifecycle === 'active' ? undefined : invocation.invocationId),
    };
    if (lifecycle !== 'active') this.abortConcurrentDeadlines(invocation.invocationId);
    return result;
  }

  private consumeResultBudget(result: ToolResult, completedAtMs: number): RuntimeBudgetState {
    const receiptBytes = result.receipt.outputBytes;
    const { budget, usage } = this.state.budget;
    const receiptCapacityExhausted =
      usage.outputBytes + receiptBytes > budget.maxOutputBytes ||
      usage.toolResultBytes + receiptBytes > budget.maxToolResultBytes;
    const mandatoryConcurrentCancellation =
      this.state.lifecycle !== 'active' && result.status === 'cancelled';
    if (mandatoryConcurrentCancellation && receiptCapacityExhausted) {
      return consumeRuntimeBudget(this.state.budget, {}, completedAtMs);
    }
    return consumeRuntimeBudget(
      this.state.budget,
      { outputBytes: receiptBytes, toolResultBytes: receiptBytes },
      completedAtMs,
    );
  }

  private abortConcurrentDeadlines(completedInvocationId: string): void {
    for (const [invocationId, deadline] of this.activeDeadlines) {
      if (invocationId !== completedInvocationId) {
        deadline.abort(new Error('Runtime dispatcher reached a terminal state'));
      }
    }
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
