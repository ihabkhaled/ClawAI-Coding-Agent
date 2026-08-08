import { z } from 'zod';

import {
  advanceRuntimeInvocationRegistryTurn,
  admitRuntimeInvocation,
  closeRuntimeInvocationRegistry,
  createRuntimeInvocationRegistry,
  type RuntimeInvocationRegistry,
} from '../core/runtime/runtime-invocation-registry';
import {
  MAX_RUNTIME_JSON_STRING_LENGTH,
  runtimeJsonObjectSchema,
  type RuntimeJsonObject,
} from '../core/runtime/runtime-json-value';
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
import { normalizeToolInvocationForAdmission } from '../core/runtime/runtime-tool-normalization';
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

/** Leaves room for the surrounding sentence inside the schema's 2,000 cap. */
const MAX_FAILURE_REASON_CHARACTERS = 1_500;
const runtimeToolExecutionOutputSchema = z
  .object({
    structured: runtimeJsonObjectSchema.optional(),
    modelText: z.string().max(MAX_RUNTIME_JSON_STRING_LENGTH).optional(),
  })
  .strict();

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
interface RuntimeToolDispatchOutcome {
  readonly error?: ToolResult['error'];
  readonly modelText?: string;
  readonly status: ToolResult['status'];
  readonly structured?: RuntimeJsonObject;
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
    const normalized = normalizeToolInvocationForAdmission(value);
    const admission = admitRuntimeInvocation(this.state.registry, normalized);
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
      let outcome: RuntimeToolDispatchOutcome | undefined;
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
          outcome = this.validatedExecutionOutcome(output);
        }
      } catch (error: unknown) {
        this.assertCurrentEpochs();
        outcome = this.failureOutcome(deadline, error);
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

  /**
   * Turns a thrown executor failure into the tool error the model is shown.
   *
   * `cause` used to be discarded — the catch above took no parameter — so every
   * failure became the same sentence: "The trusted tool executor failed."
   * Seventeen different models were screened against this runtime and all
   * seventeen produced a valid `workspace.files list` request that failed with
   * that message and 166 bytes, identical every time. Nothing in the panel, the
   * Output channel, the run journal or the backend logs said why, so the one
   * fact needed to fix it was the one fact thrown away. The model's own reply
   * was "the trusted executor returned a non-retryable failure" — which is all
   * it had.
   *
   * The reason is handed over raw on purpose. `buildRuntimeToolResult` already
   * runs every tool error through `sanitizeError`, which redacts it and derives
   * `redactionApplied` from whether its own pass changed anything. Redacting
   * here as well left that pass nothing to do, so the flag came back false on a
   * message that had in fact been scrubbed — a duplicated concern that made the
   * honest signal dishonest.
   */
  private failureOutcome(
    deadline: RuntimeDeadline,
    cause?: unknown,
  ): {
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
    const reason =
      cause instanceof Error ? cause.message.trim().slice(0, MAX_FAILURE_REASON_CHARACTERS) : '';
    return {
      status: 'failed',
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message:
          reason.length === 0
            ? 'The trusted tool executor failed.'
            : `The trusted tool executor failed: ${reason}`,
        retryable: false,
        redactionApplied: false,
      },
    };
  }

  private validatedExecutionOutcome(
    output: RuntimeToolExecutionOutput,
  ): RuntimeToolDispatchOutcome {
    const parsed = runtimeToolExecutionOutputSchema.safeParse(output);
    if (!parsed.success) return this.invalidOutputOutcome();
    return {
      status: 'succeeded',
      ...(parsed.data.structured === undefined ? {} : { structured: parsed.data.structured }),
      ...(parsed.data.modelText === undefined ? {} : { modelText: parsed.data.modelText }),
    };
  }

  private invalidOutputOutcome(): RuntimeToolDispatchOutcome {
    return {
      status: 'failed',
      error: {
        code: 'TOOL_OUTPUT_INVALID',
        message:
          'The trusted tool returned output outside the bounded Runtime V2 contract. ' +
          'Narrow read-only requests; do not repeat mutations automatically.',
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
    outcome: RuntimeToolDispatchOutcome,
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

  /**
   * `cancelled` and `denied` are human decisions to stop, and `timed-out`
   * means the run's whole deadline is spent — those end the dispatcher
   * whatever the continuation says. A `failed` step defers to the continuation
   * exactly as a succeeded one does, mirroring the run service's
   * `terminalSteeringLifecycle`: under `continue`, the failure is the model's
   * next input, not the run's end.
   *
   * `failed` used to terminalize unconditionally, which closed the invocation
   * registry while the run service — by design — kept the run alive and
   * submitted the error to the backend. The model reasoned about it and asked
   * for its next tool, and that recovery turn hit the closed registry:
   * `beginModelTurn` threw RuntimeRunEndedError, the stream stopped following,
   * and the coordinator cancelled the run as abandoned. The executor error was
   * surfaced to the model and then the one turn that could act on it was
   * dropped. Failure loops stay bounded because every dispatch still debits
   * the tool-call and tool-round budget.
   */
  private lifecycleFor(
    result: ToolResult,
    continuation: Continuation,
  ): RuntimeToolDispatcherSnapshot['lifecycle'] {
    if (result.status === 'denied') return 'blocked';
    if (result.status === 'cancelled') return 'cancelled';
    if (result.status === 'timed-out') return 'failed';
    if (continuation.action === 'continue') return 'active';
    return result.status === 'succeeded' ? 'completed' : 'failed';
  }
}
