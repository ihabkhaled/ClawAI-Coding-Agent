import {
  acknowledgeSteering,
  applySteering as applyQueuedSteering,
  closeSteeringQueue,
  createSteeringQueue,
  receiveSteering as receiveQueuedSteering,
  type SteeringQueueSnapshot,
} from '../core/runtime/runtime-steering-queue';
import { parseToolInvocation } from '../core/runtime/runtime-tool-contracts';

import { RuntimeToolDispatcher } from './runtime-tool-dispatcher';

import type { RuntimeToolExecutorPort, RuntimeToolPolicyPort } from './runtime-tool-dispatcher';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type {
  Continuation,
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
}

export interface RuntimeRunStartReceipt {
  readonly runId: string;
}

export interface RuntimeRunTransportPort {
  cancel(runId: string): Promise<void>;
  start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt>;
  submitResult(runId: string, result: ToolResult, signal: AbortSignal): Promise<void>;
}

export interface RuntimeEventSink {
  publish(event: RuntimeEvent): void;
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
  readonly receiptId: () => string;
  readonly transport: RuntimeRunTransportPort;
}

interface ActiveRuntimeRun {
  readonly controller: AbortController;
  readonly dispatcher: RuntimeToolDispatcher;
  readonly start: RuntimeRunStart;
  nextSequence: number;
  steering: SteeringQueueSnapshot;
}

function terminalSteeringLifecycle(
  result: ToolResult,
  continuation: Continuation,
): Exclude<SteeringQueueSnapshot['lifecycle'], 'active'> | undefined {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'succeeded' && continuation.action === 'continue') return undefined;
  return result.status === 'succeeded' ? 'completed' : 'failed';
}

function epochsMatch(left: ToolInvocation['epochs'], right: ToolInvocation['epochs']): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

function runtimeEvent(
  active: ActiveRuntimeRun,
  invocation: ToolInvocation,
  result: ToolResult,
  now: number,
): RuntimeEvent {
  const sequence = active.nextSequence;
  active.nextSequence += 1;
  return {
    schemaVersion: '2.0',
    epochs: active.start.epochs,
    eventId: `event:${invocation.invocationId}:${String(sequence)}`,
    runId: active.start.runId,
    sequence,
    timestamp: new Date(now).toISOString(),
    type: 'tool.completed',
    visibility: 'user',
    sensitivity: 'sensitive-redacted',
    payload: {
      invocationId: invocation.invocationId,
      receipt: {
        durationMs: result.receipt.durationMs,
        outputBytes: result.receipt.outputBytes,
        receiptId: result.receipt.receiptId,
        redactionApplied: result.receipt.redactionApplied,
        truncated: result.receipt.truncated,
      },
      status: result.status,
    },
  };
}

export class RuntimeRunService {
  private active: ActiveRuntimeRun | undefined;
  private completed: ActiveRuntimeRun | undefined;
  private starting = false;

  constructor(private readonly dependencies: RuntimeRunServiceDependencies) {}

  async start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt> {
    if (this.active !== undefined || this.starting) {
      throw new Error('A runtime run is already active');
    }
    this.assertCurrentEpochs(input.epochs);
    this.starting = true;
    let remotelyAdmittedRunId: string | undefined;
    try {
      const receipt = await this.dependencies.transport.start(input);
      remotelyAdmittedRunId = receipt.runId;
      if (receipt.runId !== input.runId) {
        throw new Error('Runtime transport returned a mismatched run');
      }
      this.assertCurrentEpochs(input.epochs);
      const controller = new AbortController();
      this.completed = undefined;
      this.active = {
        controller,
        dispatcher: new RuntimeToolDispatcher({
          budget: input.budget,
          currentEpochs: this.dependencies.currentEpochs,
          definitions: input.definitions,
          epochs: input.epochs,
          executor: this.dependencies.executor,
          now: () => this.dependencies.clock.now(),
          policy: this.dependencies.policy,
          receiptId: this.dependencies.receiptId,
          runId: input.runId,
          startedAtMs: this.dependencies.clock.now(),
          turnId: input.turnId,
        }),
        nextSequence: 1,
        start: input,
        steering: createSteeringQueue(input.runId, input.epochs),
      };
      return receipt;
    } catch (error) {
      if (remotelyAdmittedRunId !== undefined) {
        try {
          await this.dependencies.transport.cancel(remotelyAdmittedRunId);
        } catch {
          // Preserve the admission failure; cancellation is best-effort compensation.
        }
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async dispatch(value: unknown, continuation: Continuation): Promise<ToolResult> {
    const active = this.active ?? this.requireCompletedReplay(value);
    active.controller.signal.throwIfAborted();
    const invocation = this.assertInvocation(value, active);
    const priorResult = active.dispatcher.snapshot.results[invocation.invocationId];
    const result = await active.dispatcher.dispatch(
      invocation,
      continuation,
      active.controller.signal,
    );
    if (priorResult !== undefined) return result;
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    await this.dependencies.transport.submitResult(
      active.start.runId,
      result,
      active.controller.signal,
    );
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    this.dependencies.eventSink.publish(
      runtimeEvent(active, invocation, result, this.dependencies.clock.now()),
    );
    const lifecycle = terminalSteeringLifecycle(result, continuation);
    if (lifecycle !== undefined) {
      active.steering = closeSteeringQueue(active.steering, lifecycle);
      this.completed = active;
      this.active = undefined;
    }
    return result;
  }

  async cancel(): Promise<void> {
    const active = this.requireActive();
    if (!active.controller.signal.aborted)
      active.controller.abort(new Error('Runtime run cancelled'));
    if (active.steering.lifecycle === 'active') {
      active.steering = closeSteeringQueue(active.steering, 'cancelled');
    }
    await this.dependencies.transport.cancel(active.start.runId);
    this.completed = active;
    this.active = undefined;
  }

  receiveSteering(value: unknown): SteeringQueueSnapshot {
    if (this.active === undefined && this.completed !== undefined) {
      throw new Error(`Steering queue is ${this.completed.steering.lifecycle}`);
    }
    const active = this.requireActive();
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    active.steering = receiveQueuedSteering(active.steering, value);
    return active.steering;
  }

  applySteering(steeringId: string, boundary: string): SteeringQueueSnapshot {
    const active = this.requireActive();
    active.controller.signal.throwIfAborted();
    active.steering = applyQueuedSteering(
      acknowledgeSteering(active.steering, steeringId, boundary),
      steeringId,
      boundary,
    );
    return active.steering;
  }

  private assertInvocation(value: unknown, active: ActiveRuntimeRun): ToolInvocation {
    const candidate = parseToolInvocation(value);
    if (!epochsMatch(candidate.epochs, active.start.epochs))
      throw new Error('Runtime invocation epochs are stale');
    if (candidate.runId !== active.start.runId || candidate.turnId !== active.start.turnId) {
      throw new Error('Runtime invocation belongs to another run');
    }
    this.assertCurrentEpochs(active.start.epochs);
    return candidate;
  }

  private assertCurrentEpochs(epochs: ToolInvocation['epochs']): void {
    if (!epochsMatch(epochs, this.dependencies.currentEpochs())) {
      throw new Error('Runtime run epochs are stale');
    }
  }

  private requireActive(): ActiveRuntimeRun {
    if (this.active === undefined) throw new Error('No runtime run is active');
    return this.active;
  }

  private requireCompletedReplay(value: unknown): ActiveRuntimeRun {
    const completed = this.completed;
    if (completed === undefined) throw new Error('No runtime run is active');
    const candidate = parseToolInvocation(value);
    if (candidate.runId !== completed.start.runId || candidate.turnId !== completed.start.turnId) {
      throw new Error('No runtime run is active');
    }
    if (completed.controller.signal.aborted) return completed;
    if (completed.dispatcher.snapshot.results[candidate.invocationId] === undefined) {
      throw new Error('No runtime run is active');
    }
    return completed;
  }
}
