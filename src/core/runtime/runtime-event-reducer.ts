import { z } from 'zod';

import {
  assertRuntimeEventCanAppend,
  assertRuntimeEventCanCreate,
} from './runtime-event-admission';
import {
  canonicalizeRuntimeValue,
  compactRuntimeEventIdentities,
  isRuntimeEventReplay,
  withoutRuntimeRunIdentities,
  type RuntimeEventIdentity,
} from './runtime-event-identity';
import { compactProjectionBounds, compactTimeline } from './runtime-event-reducer-bounds';
import {
  sameBudgetLimits,
  usageDoesNotRegress,
  usageWithinLimits,
} from './runtime-event-reducer-budget';
import { runtimeProtocolFallback, type RuntimeProtocolSelection } from './runtime-negotiation';
import { admitRuntimeRunCollection, selectActiveRuntimeRun } from './runtime-run-collection';
import { runBudgetSchema, toolInvocationSchema, type RunBudget } from './runtime-tool-contracts';

import type { CapabilityManifest } from './capability-manifest';
import type { RuntimeEvent } from './runtime-protocol.schemas';
import type { RuntimeBudgetUsage } from './runtime-run-budget';

export type RuntimeRunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface RuntimeRunSnapshot {
  readonly budget: RuntimeBudgetProjection | undefined;
  readonly epochs: RuntimeEvent['epochs'];
  readonly lastSequence: number;
  readonly invocationOrder: readonly string[];
  readonly invocations: Readonly<Record<string, RuntimeInvocationProjection>>;
  readonly phase: string | undefined;
  readonly runId: string;
  readonly status: RuntimeRunStatus;
  readonly steering: Readonly<Record<string, RuntimeSteeringProjection>>;
  readonly steeringNextSequence: number;
  readonly steeringOrder: readonly string[];
  readonly timeline: readonly RuntimeEvent[];
  readonly turnOrder: readonly string[];
  readonly turns: Readonly<Record<string, RuntimeTurnProjection>>;
}

export interface RuntimeTurnProjection {
  readonly status: 'streaming' | 'completed' | 'failed';
  readonly summary?: string;
  readonly textBytes: number;
}

export interface RuntimeReceiptProjection {
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly receiptId: string;
  readonly redactionApplied: boolean;
  readonly truncated: boolean;
}

export interface RuntimeInvocationProjection {
  readonly operation: string;
  readonly receipt?: RuntimeReceiptProjection;
  readonly status:
    'requested' | 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timed-out';
  readonly toolName: string;
}

export interface RuntimeSteeringProjection {
  readonly reason?: 'stale-epochs' | 'run-cancelled' | 'run-terminal';
  readonly sequence: number;
  readonly status: 'received' | 'applied' | 'rejected';
}

export interface RuntimeBudgetProjection {
  readonly limits: RunBudget;
  readonly usage: RuntimeBudgetUsage;
}

export interface RuntimeSnapshot {
  readonly activeRunId: string | undefined;
  readonly capabilityManifest: CapabilityManifest | undefined;
  readonly eventIds: Readonly<Record<string, RuntimeEventIdentity>>;
  readonly protocolSelection: RuntimeProtocolSelection;
  readonly runOrder: readonly string[];
  readonly runs: Readonly<Record<string, RuntimeRunSnapshot>>;
}

const phasePayloadSchema = z.object({ phase: z.string().trim().min(1).max(120) }).strict();
const emptyPayloadSchema = z.object({}).strict();
const identifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{7,127}$/u);
const turnPayloadSchema = z.object({ turnId: identifierSchema }).strict();
const deltaPayloadSchema = z
  .object({ text: z.string().max(65_536), turnId: identifierSchema })
  .strict();
const summaryPayloadSchema = z
  .object({ summary: z.string().trim().min(1).max(4_096), turnId: identifierSchema })
  .strict();
const requestedPayloadSchema = z
  .object({
    invocationId: identifierSchema,
    invocation: toolInvocationSchema.optional(),
    operation: z.string().trim().min(1).max(80),
    toolName: z.string().trim().min(2).max(80),
  })
  .strict();
const startedPayloadSchema = z.object({ invocationId: identifierSchema }).strict();
const receiptPayloadSchema = z
  .object({
    durationMs: z.number().int().nonnegative().max(86_400_000),
    outputBytes: z.number().int().nonnegative().max(16_777_216),
    receiptId: identifierSchema,
    redactionApplied: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();
const completedPayloadSchema = z
  .object({
    invocationId: identifierSchema,
    receipt: receiptPayloadSchema,
    status: z.enum(['succeeded', 'failed', 'denied', 'cancelled', 'timed-out']),
  })
  .strict();
const steeringPayloadSchema = z
  .object({ steeringId: identifierSchema, sequence: z.number().int().nonnegative() })
  .strict();
const rejectedSteeringPayloadSchema = steeringPayloadSchema
  .extend({
    reason: z.enum(['stale-epochs', 'run-cancelled', 'run-terminal']),
  })
  .strict();
const budgetUsageSchema = z
  .object({
    modelTurns: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
    repairAttempts: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    toolResultBytes: z.number().int().nonnegative(),
    toolRounds: z.number().int().nonnegative(),
  })
  .strict();
const budgetPayloadSchema = z
  .object({ limits: runBudgetSchema, usage: budgetUsageSchema })
  .strict();
const terminalStatuses: Readonly<Record<string, RuntimeRunStatus>> = {
  'run.blocked': 'blocked',
  'run.cancelled': 'cancelled',
  'run.completed': 'completed',
  'run.failed': 'failed',
};

export function createRuntimeSnapshot(
  capabilityManifest?: CapabilityManifest,
  protocolSelection: RuntimeProtocolSelection = runtimeProtocolFallback('endpoint-unavailable'),
): RuntimeSnapshot {
  return {
    activeRunId: undefined,
    capabilityManifest,
    eventIds: {},
    protocolSelection,
    runOrder: [],
    runs: {},
  };
}

function statusFor(event: RuntimeEvent, current: RuntimeRunStatus): RuntimeRunStatus {
  return terminalStatuses[event.type] ?? current;
}

function phaseFor(event: RuntimeEvent, current: string | undefined): string | undefined {
  if (event.type !== 'run.phase') {
    return current;
  }
  return phasePayloadSchema.parse(event.payload).phase;
}

function normalizedEvent(event: RuntimeEvent): RuntimeEvent {
  return event.type === 'run.phase.changed' ? { ...event, type: 'run.phase' } : event;
}

function invalidPayload(event: RuntimeEvent): never {
  throw new Error(`Runtime event ${event.type} has an invalid payload`);
}

function parseKnownPayload<T>(event: RuntimeEvent, schema: z.ZodType<T>): T {
  const result = schema.safeParse(event.payload);
  if (!result.success) invalidPayload(event);
  return result.data;
}

function assertTurn(event: RuntimeEvent, turnId: string): void {
  if (event.turnId !== turnId)
    throw new Error(`Runtime event ${event.type} has a mismatched turn identifier`);
}

function assertInvocationCorrelation(event: RuntimeEvent, invocationId: string): void {
  const correlatedInvocationId = event.correlation?.invocationId;
  if (
    correlatedInvocationId !== undefined &&
    correlatedInvocationId !== null &&
    correlatedInvocationId !== invocationId
  ) {
    throw new Error(`Runtime event ${event.type} has a mismatched invocation correlation`);
  }
}

type RuntimeProjectionState = Pick<
  RuntimeRunSnapshot,
  | 'budget'
  | 'invocationOrder'
  | 'invocations'
  | 'steering'
  | 'steeringNextSequence'
  | 'steeringOrder'
  | 'turnOrder'
  | 'turns'
>;

function projectionState(run: RuntimeRunSnapshot | undefined): RuntimeProjectionState {
  if (run !== undefined) {
    return {
      budget: run.budget,
      invocationOrder: run.invocationOrder,
      invocations: run.invocations,
      steering: run.steering,
      steeringNextSequence: run.steeringNextSequence,
      steeringOrder: run.steeringOrder,
      turnOrder: run.turnOrder,
      turns: run.turns,
    };
  }
  return {
    budget: undefined,
    invocationOrder: [],
    invocations: {},
    steering: {},
    steeringNextSequence: 0,
    steeringOrder: [],
    turnOrder: [],
    turns: {},
  };
}

function projectTurnStarted(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, turnPayloadSchema);
  assertTurn(event, payload.turnId);
  if (base.turns[payload.turnId] !== undefined) invalidPayload(event);
  return {
    ...base,
    turnOrder: [...base.turnOrder, payload.turnId],
    turns: { ...base.turns, [payload.turnId]: { status: 'streaming', textBytes: 0 } },
  };
}

function streamingTurn(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
  turnId: string,
): RuntimeTurnProjection {
  assertTurn(event, turnId);
  const current = base.turns[turnId];
  if (current?.status !== 'streaming') invalidPayload(event);
  return current;
}

function projectDelta(event: RuntimeEvent, base: RuntimeProjectionState): RuntimeProjectionState {
  const payload = parseKnownPayload(event, deltaPayloadSchema);
  const current = streamingTurn(event, base, payload.turnId);
  const textBytes = current.textBytes + new TextEncoder().encode(payload.text).byteLength;
  if (textBytes > 65_536) invalidPayload(event);
  return { ...base, turns: { ...base.turns, [payload.turnId]: { ...current, textBytes } } };
}

function projectSummary(event: RuntimeEvent, base: RuntimeProjectionState): RuntimeProjectionState {
  const payload = parseKnownPayload(event, summaryPayloadSchema);
  const current = streamingTurn(event, base, payload.turnId);
  return {
    ...base,
    turns: {
      ...base.turns,
      [payload.turnId]: { ...current, status: 'completed', summary: payload.summary },
    },
  };
}

function projectRequested(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, requestedPayloadSchema);
  assertInvocationCorrelation(event, payload.invocationId);
  if (
    payload.invocation !== undefined &&
    (payload.invocation.invocationId !== payload.invocationId ||
      payload.invocation.operation !== payload.operation ||
      payload.invocation.toolName !== payload.toolName ||
      payload.invocation.runId !== event.runId)
  )
    invalidPayload(event);
  if (base.invocations[payload.invocationId] !== undefined) invalidPayload(event);
  return {
    ...base,
    invocationOrder: [...base.invocationOrder, payload.invocationId],
    invocations: {
      ...base.invocations,
      [payload.invocationId]: {
        operation: payload.operation,
        status: 'requested',
        toolName: payload.toolName,
      },
    },
  };
}

function projectStarted(event: RuntimeEvent, base: RuntimeProjectionState): RuntimeProjectionState {
  const payload = parseKnownPayload(event, startedPayloadSchema);
  assertInvocationCorrelation(event, payload.invocationId);
  const current = base.invocations[payload.invocationId];
  if (current?.status !== 'requested') invalidPayload(event);
  return {
    ...base,
    invocations: { ...base.invocations, [payload.invocationId]: { ...current, status: 'running' } },
  };
}

function projectCompleted(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, completedPayloadSchema);
  assertInvocationCorrelation(event, payload.invocationId);
  const current = base.invocations[payload.invocationId];
  if (current?.status !== 'running') invalidPayload(event);
  return {
    ...base,
    invocations: {
      ...base.invocations,
      [payload.invocationId]: { ...current, receipt: payload.receipt, status: payload.status },
    },
  };
}

function projectSteering(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, steeringPayloadSchema);
  const current = base.steering[payload.steeringId];
  if (
    event.type === 'run.steering.received' &&
    (current !== undefined || payload.sequence !== base.steeringNextSequence)
  ) {
    invalidPayload(event);
  }
  if (
    event.type === 'run.steering.applied' &&
    (current?.status !== 'received' || current.sequence !== payload.sequence)
  ) {
    invalidPayload(event);
  }
  const status = event.type === 'run.steering.received' ? 'received' : 'applied';
  return {
    ...base,
    steering: { ...base.steering, [payload.steeringId]: { sequence: payload.sequence, status } },
    steeringNextSequence:
      event.type === 'run.steering.received'
        ? base.steeringNextSequence + 1
        : base.steeringNextSequence,
    steeringOrder:
      current === undefined ? [...base.steeringOrder, payload.steeringId] : base.steeringOrder,
  };
}

function projectRejectedSteering(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, rejectedSteeringPayloadSchema);
  const current = base.steering[payload.steeringId];
  if (current === undefined && payload.sequence !== base.steeringNextSequence) {
    invalidPayload(event);
  }
  if (
    current !== undefined &&
    (current.sequence !== payload.sequence || current.status !== 'received')
  ) {
    invalidPayload(event);
  }
  return {
    ...base,
    steering: {
      ...base.steering,
      [payload.steeringId]: {
        reason: payload.reason,
        sequence: payload.sequence,
        status: 'rejected',
      },
    },
    steeringNextSequence:
      current === undefined ? base.steeringNextSequence + 1 : base.steeringNextSequence,
    steeringOrder:
      current === undefined ? [...base.steeringOrder, payload.steeringId] : base.steeringOrder,
  };
}

function projectBudget(event: RuntimeEvent, base: RuntimeProjectionState): RuntimeProjectionState {
  const payload = parseKnownPayload(event, budgetPayloadSchema);
  const limits = payload.limits;
  const usage = payload.usage;
  if (!usageWithinLimits(usage, limits)) invalidPayload(event);
  const previous = base.budget;
  if (
    previous !== undefined &&
    (!sameBudgetLimits(previous.limits, limits) || !usageDoesNotRegress(previous.usage, usage))
  ) {
    invalidPayload(event);
  }
  return { ...base, budget: { limits: payload.limits, usage: payload.usage } };
}

function projectPhase(event: RuntimeEvent, base: RuntimeProjectionState): RuntimeProjectionState {
  parseKnownPayload(event, phasePayloadSchema);
  return base;
}

type RuntimeProjectionHandler = (
  event: RuntimeEvent,
  base: RuntimeProjectionState,
) => RuntimeProjectionState;

const projectionHandlers: Readonly<Record<string, RuntimeProjectionHandler>> = {
  'model.delta': projectDelta,
  'model.summary': projectSummary,
  'model.turn.started': projectTurnStarted,
  'run.budget.updated': projectBudget,
  'run.phase': projectPhase,
  'run.steering.applied': projectSteering,
  'run.steering.received': projectSteering,
  'run.steering.rejected': projectRejectedSteering,
  'tool.completed': projectCompleted,
  'tool.requested': projectRequested,
  'tool.started': projectStarted,
};

const knownPayloadSchemas: Readonly<Record<string, z.ZodType>> = {
  'model.delta': deltaPayloadSchema,
  'model.summary': summaryPayloadSchema,
  'model.turn.started': turnPayloadSchema,
  'run.blocked': emptyPayloadSchema,
  'run.budget.updated': budgetPayloadSchema,
  'run.cancelled': emptyPayloadSchema,
  'run.completed': emptyPayloadSchema,
  'run.created': emptyPayloadSchema,
  'run.failed': emptyPayloadSchema,
  'run.phase': phasePayloadSchema,
  'run.steering.applied': steeringPayloadSchema,
  'run.steering.received': steeringPayloadSchema,
  'run.steering.rejected': rejectedSteeringPayloadSchema,
  'tool.completed': completedPayloadSchema,
  'tool.requested': requestedPayloadSchema,
  'tool.started': startedPayloadSchema,
};

function applyKnownProjection(
  event: RuntimeEvent,
  run: RuntimeRunSnapshot | undefined,
): RuntimeProjectionState {
  const base = projectionState(run);
  const projection = projectionHandlers[event.type]?.(event, base) ?? base;
  return compactProjectionBounds(projection);
}

export function reduceRuntimeEvent(
  snapshot: RuntimeSnapshot,
  event: RuntimeEvent,
): RuntimeSnapshot {
  const normalized = normalizedEvent(event);
  if (isRuntimeEventReplay(snapshot.eventIds, normalized)) return snapshot;

  const collection = admitRuntimeRunCollection(snapshot.runs, snapshot.runOrder, normalized.runId);
  const existingRun = collection.runs[normalized.runId];
  if (existingRun === undefined) {
    assertRuntimeEventCanCreate(normalized);
  } else {
    assertRuntimeEventCanAppend(existingRun, normalized);
  }

  const knownPayloadSchema = knownPayloadSchemas[normalized.type];
  if (knownPayloadSchema !== undefined) parseKnownPayload(normalized, knownPayloadSchema);

  const currentStatus = existingRun?.status ?? 'running';
  const projection = applyKnownProjection(normalized, existingRun);
  const priorTimeline = existingRun?.timeline ?? [];
  const timeline = compactTimeline(priorTimeline, normalized);
  const nextRun: RuntimeRunSnapshot = {
    ...projection,
    epochs: existingRun?.epochs ?? normalized.epochs,
    lastSequence: normalized.sequence,
    phase: phaseFor(normalized, existingRun?.phase),
    runId: normalized.runId,
    status: statusFor(normalized, currentStatus),
    timeline,
  };
  const nextRuns = { ...collection.runs, [normalized.runId]: nextRun };
  const nextActiveRunId = selectActiveRuntimeRun(snapshot.activeRunId, normalized.runId, nextRuns);

  return {
    activeRunId: nextActiveRunId,
    capabilityManifest: snapshot.capabilityManifest,
    eventIds: {
      ...compactRuntimeEventIdentities(
        withoutRuntimeRunIdentities(snapshot.eventIds, collection.evictedRunId),
        priorTimeline,
        timeline,
      ),
      [normalized.eventId]: {
        fingerprint: canonicalizeRuntimeValue(normalized),
        runId: normalized.runId,
        sequence: normalized.sequence,
      },
    },
    protocolSelection: snapshot.protocolSelection,
    runOrder: collection.order,
    runs: nextRuns,
  };
}
