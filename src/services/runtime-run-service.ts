import {
  createRuntimeSnapshot,
  reduceRuntimeEvent,
  type RuntimeSnapshot,
} from '../core/runtime/runtime-event-reducer';
import {
  acknowledgeSteering,
  applySteering as applyQueuedSteering,
  closeSteeringQueue,
  createSteeringQueue,
  receiveSteering as receiveQueuedSteering,
  steeringMessageSchema,
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
  readonly receiptId: () => string;
  readonly transport: RuntimeRunTransportPort;
}

interface ActiveRuntimeRun {
  readonly controller: AbortController;
  readonly dispatcher: RuntimeToolDispatcher;
  readonly start: RuntimeRunStart;
  currentTurnId: string;
  nextSequence: number;
  snapshot: RuntimeSnapshot;
  steering: SteeringQueueSnapshot;
}

type RuntimeTerminalLifecycle = 'blocked' | 'cancelled' | 'completed' | 'failed';

function terminalSteeringLifecycle(
  result: ToolResult,
  continuation: Continuation,
): RuntimeTerminalLifecycle | undefined {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'denied') return 'blocked';
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

function eventFor(
  active: ActiveRuntimeRun,
  type: RuntimeEvent['type'],
  payload: RuntimeEvent['payload'],
  now: number,
  turnId?: string,
): RuntimeEvent {
  const sequence = active.nextSequence;
  return {
    schemaVersion: '2.0',
    epochs: active.start.epochs,
    eventId: `event:${active.start.runId}:${String(sequence)}`,
    runId: active.start.runId,
    sequence,
    sensitivity: 'sensitive-redacted',
    timestamp: new Date(now).toISOString(),
    type,
    visibility: 'user',
    ...(turnId === undefined ? {} : { turnId }),
    payload,
  };
}

function budgetPayload(active: ActiveRuntimeRun): RuntimeEvent['payload'] {
  const { budget, usage } = active.dispatcher.snapshot.budget;
  return { limits: budget, usage };
}

export class RuntimeRunService {
  private active: ActiveRuntimeRun | undefined;
  private completed: ActiveRuntimeRun | undefined;
  private starting = false;

  constructor(private readonly dependencies: RuntimeRunServiceDependencies) {}

  get snapshot(): RuntimeSnapshot {
    return this.active?.snapshot ?? this.completed?.snapshot ?? createRuntimeSnapshot();
  }

  async start(input: RuntimeRunStart): Promise<RuntimeRunStartReceipt> {
    if (this.active !== undefined || this.starting) {
      throw new Error('A runtime run is already active');
    }
    this.assertCurrentEpochs(input.epochs);
    this.starting = true;
    const completedBeforeStart = this.completed;
    let admittedActive: ActiveRuntimeRun | undefined;
    let remotelyAdmittedRunId: string | undefined;
    try {
      const receipt = await this.dependencies.transport.start(input);
      remotelyAdmittedRunId = receipt.runId;
      if (receipt.runId !== input.runId)
        throw new Error('Runtime transport acknowledged a mismatched run identifier');
      const admittedInput = { ...input, runId: receipt.runId };
      this.assertCurrentEpochs(input.epochs);
      const controller = new AbortController();
      this.completed = undefined;
      this.active = {
        controller,
        currentTurnId: input.turnId,
        dispatcher: new RuntimeToolDispatcher({
          budget: input.budget,
          consumeModelLifecycleBudget: false,
          currentEpochs: this.dependencies.currentEpochs,
          definitions: admittedInput.definitions,
          epochs: admittedInput.epochs,
          executor: this.dependencies.executor,
          now: () => this.dependencies.clock.now(),
          policy: this.dependencies.policy,
          receiptId: this.dependencies.receiptId,
          runId: admittedInput.runId,
          startedAtMs: this.dependencies.clock.now(),
          turnId: admittedInput.turnId,
        }),
        nextSequence: 0,
        snapshot: createRuntimeSnapshot(),
        start: admittedInput,
        steering: createSteeringQueue(admittedInput.runId, admittedInput.epochs),
      };
      admittedActive = this.active;
      const active = this.requireActive();
      this.publish(active, eventFor(active, 'run.created', {}, this.dependencies.clock.now()));
      return receipt;
    } catch (error) {
      if (admittedActive !== undefined) {
        this.active = undefined;
        this.completed = completedBeforeStart;
      }
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
      {
        onInvocationAdmitted: (admitted) => {
          this.publishBatch(active, [
            (staged) =>
              eventFor(
                staged,
                'tool.requested',
                {
                  invocationId: admitted.invocationId,
                  operation: admitted.operation,
                  toolName: admitted.toolName,
                },
                this.dependencies.clock.now(),
              ),
            (staged) =>
              eventFor(
                staged,
                'tool.started',
                { invocationId: admitted.invocationId },
                this.dependencies.clock.now(),
              ),
            (staged) =>
              eventFor(
                staged,
                'run.budget.updated',
                budgetPayload(staged),
                this.dependencies.clock.now(),
              ),
          ]);
        },
      },
    );
    if (priorResult !== undefined) return result;
    active.controller.signal.throwIfAborted();
    this.assertAuthoritativeResult(active, invocation.invocationId);
    this.assertCurrentEpochs(active.start.epochs);
    active.dispatcher.assertWithinBudget();
    this.publish(
      active,
      eventFor(active, 'run.budget.updated', budgetPayload(active), this.dependencies.clock.now()),
    );
    this.assertAuthoritativeResult(active, invocation.invocationId);
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    await this.dependencies.transport.submitResult(
      active.start.runId,
      result,
      active.controller.signal,
    );
    this.assertAuthoritativeResult(active, invocation.invocationId);
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    this.publish(active, runtimeEvent(active, invocation, result, this.dependencies.clock.now()));
    const lifecycle = terminalSteeringLifecycle(result, continuation);
    if (lifecycle !== undefined) {
      active.steering = closeSteeringQueue(
        active.steering,
        lifecycle === 'blocked' ? 'failed' : lifecycle,
      );
      this.publish(
        active,
        eventFor(
          active,
          lifecycle === 'completed'
            ? 'run.completed'
            : lifecycle === 'cancelled'
              ? 'run.cancelled'
              : lifecycle === 'blocked'
                ? 'run.blocked'
                : 'run.failed',
          {},
          this.dependencies.clock.now(),
        ),
      );
      this.completed = active;
      this.active = undefined;
    }
    return result;
  }

  async cancel(): Promise<void> {
    const active = this.requireActive();
    if (!active.controller.signal.aborted)
      active.controller.abort(new Error('Runtime run cancelled'));
    active.steering = closeSteeringQueue(active.steering, 'cancelled');
    this.publish(active, eventFor(active, 'run.cancelled', {}, this.dependencies.clock.now()));
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
    const message = steeringMessageSchema.parse(value);
    const nextSteering = receiveQueuedSteering(active.steering, message);
    if (nextSteering === active.steering) return active.steering;
    const rejectionReason =
      message.runId !== active.start.runId || !epochsMatch(message.epochs, active.start.epochs)
        ? 'stale-epochs'
        : undefined;
    this.publish(
      active,
      eventFor(
        active,
        rejectionReason === undefined ? 'run.steering.received' : 'run.steering.rejected',
        {
          ...(rejectionReason === undefined ? {} : { reason: rejectionReason }),
          sequence: message.sequence,
          steeringId: message.steeringId,
        },
        this.dependencies.clock.now(),
      ),
    );
    active.steering = nextSteering;
    return active.steering;
  }

  applySteering(steeringId: string, boundary: string): SteeringQueueSnapshot {
    const active = this.requireActive();
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    const acknowledged = acknowledgeSteering(active.steering, steeringId, boundary);
    this.assertCurrentEpochs(active.start.epochs);
    const nextSteering = applyQueuedSteering(acknowledged, steeringId, boundary);
    if (nextSteering === active.steering) return active.steering;
    const entry = nextSteering.entries.find(
      (candidate) => candidate.message.steeringId === steeringId,
    );
    if (entry === undefined) throw new Error(`Unknown steering message ${steeringId}`);
    this.publish(
      active,
      eventFor(
        active,
        'run.steering.applied',
        { sequence: entry.message.sequence, steeringId },
        this.dependencies.clock.now(),
      ),
    );
    active.steering = nextSteering;
    return active.steering;
  }

  beginModelTurn(repair = false, explicitTurnId?: string) {
    const active = this.requireActive();
    active.controller.signal.throwIfAborted();
    this.assertCurrentEpochs(active.start.epochs);
    const turnId = explicitTurnId ?? `${active.start.turnId}:model:${String(active.nextSequence)}`;
    const budget = active.dispatcher.recordModelLifecycle(repair, turnId);
    active.currentTurnId = turnId;
    this.publish(
      active,
      eventFor(active, 'model.turn.started', { turnId }, this.dependencies.clock.now(), turnId),
    );
    this.publish(
      active,
      eventFor(active, 'run.budget.updated', budgetPayload(active), this.dependencies.clock.now()),
    );
    return budget;
  }

  private assertInvocation(value: unknown, active: ActiveRuntimeRun): ToolInvocation {
    const candidate = parseToolInvocation(value);
    if (!epochsMatch(candidate.epochs, active.start.epochs))
      throw new Error('Runtime invocation epochs are stale');
    if (candidate.runId !== active.start.runId)
      throw new Error('Runtime invocation belongs to another run');
    if (candidate.turnId !== active.currentTurnId)
      throw new Error('Runtime invocation belongs to another turn');
    this.assertCurrentEpochs(active.start.epochs);
    return candidate;
  }

  private assertCurrentEpochs(epochs: ToolInvocation['epochs']): void {
    if (!epochsMatch(epochs, this.dependencies.currentEpochs())) {
      throw new Error('Runtime run epochs are stale');
    }
  }

  private assertAuthoritativeResult(active: ActiveRuntimeRun, invocationId: string): void {
    if (this.active !== active) throw new Error('Runtime active run changed before result commit');
    const terminalInvocationId = active.dispatcher.snapshot.terminalInvocationId;
    if (terminalInvocationId !== undefined && terminalInvocationId !== invocationId) {
      throw new Error('Runtime active run result lane is already terminal');
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
    if (candidate.runId !== completed.start.runId || candidate.turnId !== completed.currentTurnId) {
      throw new Error('No runtime run is active');
    }
    if (completed.controller.signal.aborted) return completed;
    if (completed.dispatcher.snapshot.results[candidate.invocationId] === undefined) {
      throw new Error('No runtime run is active');
    }
    return completed;
  }

  private publish(active: ActiveRuntimeRun, event: RuntimeEvent): void {
    this.publishBatch(active, [() => event]);
  }

  private publishBatch(
    active: ActiveRuntimeRun,
    factories: readonly ((staged: ActiveRuntimeRun) => RuntimeEvent)[],
  ): void {
    let staged = { ...active };
    const events: RuntimeEvent[] = [];
    for (const factory of factories) {
      const event = factory(staged);
      staged = {
        ...staged,
        nextSequence: staged.nextSequence + 1,
        snapshot: reduceRuntimeEvent(staged.snapshot, event),
      };
      events.push(event);
    }
    const priorSnapshot = active.snapshot;
    const priorSequence = active.nextSequence;
    active.snapshot = staged.snapshot;
    active.nextSequence = staged.nextSequence;
    try {
      this.dependencies.eventSink.publishBatch(events);
    } catch (error) {
      active.snapshot = priorSnapshot;
      active.nextSequence = priorSequence;
      throw error;
    }
  }
}
