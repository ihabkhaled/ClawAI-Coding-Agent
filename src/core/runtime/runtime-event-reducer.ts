import { z } from 'zod';

import {
  sameBudgetLimits,
  usageDoesNotRegress,
  usageWithinLimits,
} from './runtime-event-reducer-budget';
import { runtimeProtocolFallback, type RuntimeProtocolSelection } from './runtime-negotiation';
import { runBudgetSchema, type RunBudget } from './runtime-tool-contracts';

import type { CapabilityManifest } from './capability-manifest';
import type { RuntimeEvent } from './runtime-protocol.schemas';
import type { RuntimeBudgetUsage } from './runtime-run-budget';

export type RuntimeRunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface RuntimeEventIdentity {
  readonly fingerprint: string;
  readonly runId: string;
  readonly sequence: number;
}

export interface RuntimeRunSnapshot {
  readonly budget: RuntimeBudgetProjection | undefined;
  readonly epochs: RuntimeEvent['epochs'];
  readonly lastSequence: number;
  readonly invocations: Readonly<Record<string, RuntimeInvocationProjection>>;
  readonly phase: string | undefined;
  readonly runId: string;
  readonly status: RuntimeRunStatus;
  readonly steering: Readonly<Record<string, RuntimeSteeringProjection>>;
  readonly timeline: readonly RuntimeEvent[];
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
    runs: {},
  };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Runtime event contains a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .join(',')}}`;
  }
  throw new Error('Runtime event contains a non-serializable value');
}

function eventsMatch(identity: RuntimeEventIdentity, event: RuntimeEvent): boolean {
  return identity.fingerprint === canonicalize(event);
}

function epochsMatch(left: RuntimeEvent['epochs'], right: RuntimeEvent['epochs']): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
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
  'budget' | 'invocations' | 'steering' | 'turns'
>;

function projectionState(run: RuntimeRunSnapshot | undefined): RuntimeProjectionState {
  return {
    budget: run?.budget,
    invocations: run?.invocations ?? {},
    steering: run?.steering ?? {},
    turns: run?.turns ?? {},
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
  if (base.invocations[payload.invocationId] !== undefined) invalidPayload(event);
  return {
    ...base,
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
  if (current === undefined || !['requested', 'running'].includes(current.status))
    invalidPayload(event);
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
    (current !== undefined || payload.sequence !== Object.keys(base.steering).length)
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
  };
}

function projectRejectedSteering(
  event: RuntimeEvent,
  base: RuntimeProjectionState,
): RuntimeProjectionState {
  const payload = parseKnownPayload(event, rejectedSteeringPayloadSchema);
  const current = base.steering[payload.steeringId];
  if (current === undefined && payload.sequence !== Object.keys(base.steering).length) {
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
  return projectionHandlers[event.type]?.(event, base) ?? base;
}

function selectActiveRun(
  priorActiveRunId: string | undefined,
  eventRunId: string,
  runs: Readonly<Record<string, RuntimeRunSnapshot>>,
): string | undefined {
  if (runs[eventRunId]?.status === 'running') return eventRunId;
  if (priorActiveRunId !== undefined && runs[priorActiveRunId]?.status === 'running')
    return priorActiveRunId;
  const candidates = Object.values(runs).filter((run) => run.status === 'running');
  candidates.sort(
    (left, right) =>
      right.lastSequence - left.lastSequence || left.runId.localeCompare(right.runId),
  );
  return candidates[0]?.runId;
}

function isTerminal(status: RuntimeRunStatus): boolean {
  return status !== 'running';
}

function assertCanAppend(existingRun: RuntimeRunSnapshot, event: RuntimeEvent): void {
  const expectedSequence = existingRun.lastSequence + 1;
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `Runtime event sequence must advance from ${String(existingRun.lastSequence)} to ${String(expectedSequence)} for run ${event.runId}`,
    );
  }
  if (!epochsMatch(existingRun.epochs, event.epochs)) {
    throw new Error(`Runtime event epochs changed for run ${event.runId}`);
  }
  if (isTerminal(existingRun.status)) {
    throw new Error(`Runtime run ${event.runId} is already terminal`);
  }
}

function assertCanCreate(event: RuntimeEvent): void {
  if (event.sequence !== 0 || event.type !== 'run.created') {
    throw new Error(`Runtime run ${event.runId} must begin with run.created at sequence 0`);
  }
}

function isAlreadyApplied(snapshot: RuntimeSnapshot, event: RuntimeEvent): boolean {
  const existingIdentity = snapshot.eventIds[event.eventId];
  if (existingIdentity === undefined) return false;
  if (eventsMatch(existingIdentity, event)) return true;
  throw new Error(`Runtime event ${event.eventId} conflicts with an earlier event`);
}

export function reduceRuntimeEvent(
  snapshot: RuntimeSnapshot,
  event: RuntimeEvent,
): RuntimeSnapshot {
  if (event.type === 'run.phase.changed') {
    return reduceRuntimeEvent(snapshot, normalizedEvent(event));
  }
  if (isAlreadyApplied(snapshot, event)) return snapshot;

  const existingRun = snapshot.runs[event.runId];
  if (existingRun === undefined) {
    assertCanCreate(event);
  } else {
    assertCanAppend(existingRun, event);
  }

  const knownPayloadSchema = knownPayloadSchemas[event.type];
  if (knownPayloadSchema !== undefined) parseKnownPayload(event, knownPayloadSchema);

  const currentStatus = existingRun?.status ?? 'running';
  const projection = applyKnownProjection(event, existingRun);
  const nextRun: RuntimeRunSnapshot = {
    ...projection,
    epochs: existingRun?.epochs ?? event.epochs,
    lastSequence: event.sequence,
    phase: phaseFor(event, existingRun?.phase),
    runId: event.runId,
    status: statusFor(event, currentStatus),
    timeline: [...(existingRun?.timeline ?? []), event],
  };
  const nextRuns = { ...snapshot.runs, [event.runId]: nextRun };
  const nextActiveRunId = selectActiveRun(snapshot.activeRunId, event.runId, nextRuns);

  return {
    activeRunId: nextActiveRunId,
    capabilityManifest: snapshot.capabilityManifest,
    eventIds: {
      ...snapshot.eventIds,
      [event.eventId]: {
        fingerprint: canonicalize(event),
        runId: event.runId,
        sequence: event.sequence,
      },
    },
    protocolSelection: snapshot.protocolSelection,
    runs: nextRuns,
  };
}
