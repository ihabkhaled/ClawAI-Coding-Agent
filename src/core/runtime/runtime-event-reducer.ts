import { z } from 'zod';

import type { CapabilityManifest } from './capability-manifest';
import type { RuntimeEvent } from './runtime-protocol.schemas';

export type RuntimeRunStatus = 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

export interface RuntimeEventIdentity {
  readonly fingerprint: string;
  readonly runId: string;
  readonly sequence: number;
}

export interface RuntimeRunSnapshot {
  readonly epochs: RuntimeEvent['epochs'];
  readonly lastSequence: number;
  readonly phase: string | undefined;
  readonly runId: string;
  readonly status: RuntimeRunStatus;
  readonly timeline: readonly RuntimeEvent[];
}

export interface RuntimeSnapshot {
  readonly activeRunId: string | undefined;
  readonly capabilityManifest: CapabilityManifest | undefined;
  readonly eventIds: Readonly<Record<string, RuntimeEventIdentity>>;
  readonly runs: Readonly<Record<string, RuntimeRunSnapshot>>;
}

const phasePayloadSchema = z.object({ phase: z.string().trim().min(1).max(120) }).strict();
const terminalStatuses: Readonly<Record<string, RuntimeRunStatus>> = {
  'run.blocked': 'blocked',
  'run.cancelled': 'cancelled',
  'run.completed': 'completed',
  'run.failed': 'failed',
};

export function createRuntimeSnapshot(capabilityManifest?: CapabilityManifest): RuntimeSnapshot {
  return {
    activeRunId: undefined,
    capabilityManifest,
    eventIds: {},
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
  if (event.type !== 'run.phase.changed') {
    return current;
  }
  const result = phasePayloadSchema.safeParse(event.payload);
  if (!result.success) {
    throw new Error(`Runtime event ${event.type} has an invalid payload`);
  }
  return result.data.phase;
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

export function reduceRuntimeEvent(
  snapshot: RuntimeSnapshot,
  event: RuntimeEvent,
): RuntimeSnapshot {
  const existingIdentity = snapshot.eventIds[event.eventId];
  if (existingIdentity !== undefined) {
    if (eventsMatch(existingIdentity, event)) {
      return snapshot;
    }
    throw new Error(`Runtime event ${event.eventId} conflicts with an earlier event`);
  }

  const existingRun = snapshot.runs[event.runId];
  if (existingRun === undefined) {
    assertCanCreate(event);
  } else {
    assertCanAppend(existingRun, event);
  }

  const currentStatus = existingRun?.status ?? 'running';
  const nextRun: RuntimeRunSnapshot = {
    epochs: existingRun?.epochs ?? event.epochs,
    lastSequence: event.sequence,
    phase: phaseFor(event, existingRun?.phase),
    runId: event.runId,
    status: statusFor(event, currentStatus),
    timeline: [...(existingRun?.timeline ?? []), event],
  };
  const nextActiveRunId = isTerminal(nextRun.status) ? undefined : event.runId;

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
    runs: {
      ...snapshot.runs,
      [event.runId]: nextRun,
    },
  };
}
