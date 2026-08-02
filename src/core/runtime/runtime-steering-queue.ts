import { z } from 'zod';

import { RUNTIME_ID_PATTERN, RUNTIME_PROTOCOL_V2 } from './runtime-protocol.constants';

const MAX_STEERING_MESSAGE_BYTES = 32_768;
const MAX_STEERING_ENTRIES = 32;
const MAX_PENDING_STEERING = 8;
const MAX_STEERING_HISTORY_BYTES = 131_072;
const safeBoundaries = ['model-turn-boundary', 'tool-result-boundary'] as const;

const steeringEpochsSchema = z
  .object({
    account: z.number().int().nonnegative(),
    workspace: z.number().int().nonnegative(),
    target: z.number().int().nonnegative(),
    policy: z.number().int().nonnegative(),
  })
  .strict();

export const steeringMessageSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_PROTOCOL_V2),
    steeringId: z.string().regex(RUNTIME_ID_PATTERN),
    runId: z.string().regex(RUNTIME_ID_PATTERN),
    sequence: z.number().int().nonnegative(),
    idempotencyKey: z.string().regex(RUNTIME_ID_PATTERN),
    message: z.string().trim().min(1).max(MAX_STEERING_MESSAGE_BYTES),
    epochs: steeringEpochsSchema,
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((message, context) => {
    if (new TextEncoder().encode(message.message).byteLength > MAX_STEERING_MESSAGE_BYTES) {
      context.addIssue({
        code: 'custom',
        message: `Steering message exceeds ${String(MAX_STEERING_MESSAGE_BYTES)} bytes`,
        path: ['message'],
      });
    }
  });

export type SteeringMessage = z.infer<typeof steeringMessageSchema>;
export type SteeringStatus = 'received' | 'acknowledged' | 'applied' | 'rejected';
export type SteeringRunLifecycle = 'active' | 'completed' | 'failed' | 'cancelled';
export type SteeringRejectionReason = 'stale-epochs' | 'run-cancelled' | 'run-terminal';

export interface SteeringQueueEntry {
  readonly byteLength: number;
  readonly fingerprint: string;
  readonly message: SteeringMessage;
  readonly rejectionReason?: SteeringRejectionReason;
  readonly status: SteeringStatus;
}

export interface SteeringQueueSnapshot {
  readonly entries: readonly SteeringQueueEntry[];
  readonly epochs: SteeringMessage['epochs'];
  readonly idempotencyFingerprints: Readonly<Record<string, string>>;
  readonly lifecycle: SteeringRunLifecycle;
  readonly historyBytes: number;
  readonly nextSequence: number;
  readonly pending: readonly string[];
  readonly runId: string;
  readonly sequenceFingerprints: Readonly<Record<number, string>>;
  readonly steeringFingerprints: Readonly<Record<string, string>>;
}

export function createSteeringQueue(
  runId: string,
  epochs: SteeringMessage['epochs'],
): SteeringQueueSnapshot {
  const parsedRunId = z.string().regex(RUNTIME_ID_PATTERN).parse(runId);
  const parsedEpochs = steeringEpochsSchema.parse(epochs);
  return {
    entries: [],
    epochs: parsedEpochs,
    idempotencyFingerprints: {},
    lifecycle: 'active',
    historyBytes: 0,
    nextSequence: 0,
    pending: [],
    runId: parsedRunId,
    sequenceFingerprints: {},
    steeringFingerprints: {},
  };
}

function sameEpochs(left: SteeringMessage['epochs'], right: SteeringMessage['epochs']): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

function fingerprint(message: SteeringMessage): string {
  return JSON.stringify(message);
}

function messageBytes(message: SteeringMessage): number {
  return new TextEncoder().encode(fingerprint(message)).byteLength;
}

function compact(snapshot: SteeringQueueSnapshot): SteeringQueueSnapshot {
  const entries = [...snapshot.entries];
  while (entries.length >= MAX_STEERING_ENTRIES) {
    const index = entries.findIndex(
      (entry) => entry.status === 'applied' || entry.status === 'rejected',
    );
    if (index < 0) break;
    entries.splice(index, 1);
  }
  while (
    entries.reduce((total, entry) => total + entry.byteLength, 0) > MAX_STEERING_HISTORY_BYTES
  ) {
    const index = entries.findIndex(
      (entry) => entry.status === 'applied' || entry.status === 'rejected',
    );
    if (index < 0) break;
    entries.splice(index, 1);
  }
  if (entries.length === snapshot.entries.length) return snapshot;
  const idempotencyFingerprints: Record<string, string> = {};
  const sequenceFingerprints: Record<number, string> = {};
  const steeringFingerprints: Record<string, string> = {};
  for (const entry of entries) {
    idempotencyFingerprints[entry.message.idempotencyKey] = entry.fingerprint;
    sequenceFingerprints[entry.message.sequence] = entry.fingerprint;
    steeringFingerprints[entry.message.steeringId] = entry.fingerprint;
  }
  return {
    ...snapshot,
    entries,
    historyBytes: entries.reduce((total, entry) => total + entry.byteLength, 0),
    idempotencyFingerprints,
    sequenceFingerprints,
    steeringFingerprints,
  };
}

function rejectionFor(
  snapshot: SteeringQueueSnapshot,
  message: SteeringMessage,
): SteeringRejectionReason | undefined {
  if (snapshot.lifecycle === 'cancelled') {
    return 'run-cancelled';
  }
  if (snapshot.lifecycle !== 'active') {
    return 'run-terminal';
  }
  if (message.runId !== snapshot.runId || !sameEpochs(message.epochs, snapshot.epochs)) {
    return 'stale-epochs';
  }
  return undefined;
}

function assertReplayOrConflict(
  snapshot: SteeringQueueSnapshot,
  message: SteeringMessage,
  digest: string,
): boolean {
  const records: readonly [string | undefined, string, string][] = [
    [snapshot.sequenceFingerprints[message.sequence], 'sequence', String(message.sequence)],
    [
      snapshot.idempotencyFingerprints[message.idempotencyKey],
      'idempotency key',
      message.idempotencyKey,
    ],
    [snapshot.steeringFingerprints[message.steeringId], 'identifier', message.steeringId],
  ];
  for (const [existing, label, value] of records) {
    if (existing === undefined) continue;
    if (existing === digest) return true;
    throw new Error(`Steering ${label} ${value} conflicts with an earlier message`);
  }
  return false;
}

export function receiveSteering(
  current: SteeringQueueSnapshot,
  value: unknown,
): SteeringQueueSnapshot {
  const snapshot = compact(current);
  const message = steeringMessageSchema.parse(value);
  const digest = fingerprint(message);
  if (assertReplayOrConflict(snapshot, message, digest)) return snapshot;
  if (message.sequence !== snapshot.nextSequence) {
    throw new Error(
      `Steering sequence must be ${String(snapshot.nextSequence)} for run ${snapshot.runId}`,
    );
  }

  const byteLength = messageBytes(message);
  if (snapshot.pending.length >= MAX_PENDING_STEERING && snapshot.lifecycle === 'active') {
    throw new Error('Steering pending queue is full');
  }
  if (
    snapshot.entries.length >= MAX_STEERING_ENTRIES ||
    snapshot.historyBytes + byteLength > MAX_STEERING_HISTORY_BYTES
  ) {
    throw new Error('Steering history capacity is full');
  }

  const rejectionReason = rejectionFor(snapshot, message);
  const entry: SteeringQueueEntry = {
    byteLength,
    fingerprint: digest,
    message,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
    status: rejectionReason === undefined ? 'received' : 'rejected',
  };
  return {
    ...snapshot,
    entries: [...snapshot.entries, entry],
    historyBytes: snapshot.historyBytes + byteLength,
    idempotencyFingerprints: {
      ...snapshot.idempotencyFingerprints,
      [message.idempotencyKey]: digest,
    },
    nextSequence: snapshot.nextSequence + 1,
    pending:
      rejectionReason === undefined ? [...snapshot.pending, message.steeringId] : snapshot.pending,
    sequenceFingerprints: {
      ...snapshot.sequenceFingerprints,
      [message.sequence]: digest,
    },
    steeringFingerprints: {
      ...snapshot.steeringFingerprints,
      [message.steeringId]: digest,
    },
  };
}

function assertSafeBoundary(boundary: string): void {
  if (!(safeBoundaries as readonly string[]).includes(boundary)) {
    throw new Error('Steering may advance only at a safe boundary');
  }
}

function assertActive(snapshot: SteeringQueueSnapshot): void {
  if (snapshot.lifecycle !== 'active') {
    throw new Error(`Steering queue is ${snapshot.lifecycle}`);
  }
}

function entryIndex(snapshot: SteeringQueueSnapshot, steeringId: string): number {
  const index = snapshot.entries.findIndex((entry) => entry.message.steeringId === steeringId);
  if (index < 0) {
    throw new Error(`Unknown steering message ${steeringId}`);
  }
  return index;
}

function replaceEntry(
  snapshot: SteeringQueueSnapshot,
  index: number,
  entry: SteeringQueueEntry,
): SteeringQueueSnapshot {
  return {
    ...snapshot,
    entries: snapshot.entries.map((current, currentIndex) =>
      currentIndex === index ? entry : current,
    ),
  };
}

export function acknowledgeSteering(
  snapshot: SteeringQueueSnapshot,
  steeringId: string,
  boundary: string,
): SteeringQueueSnapshot {
  assertSafeBoundary(boundary);
  assertActive(snapshot);
  const index = entryIndex(snapshot, steeringId);
  const entry = snapshot.entries[index];
  if (entry?.status === 'acknowledged' || entry?.status === 'applied') {
    return snapshot;
  }
  if (entry?.status !== 'received') {
    throw new Error(`Steering message ${steeringId} cannot be acknowledged`);
  }
  if (snapshot.pending[0] !== steeringId) {
    throw new Error('Steering messages must be acknowledged in queue order');
  }
  return replaceEntry(snapshot, index, { ...entry, status: 'acknowledged' });
}

export function applySteering(
  snapshot: SteeringQueueSnapshot,
  steeringId: string,
  boundary: string,
): SteeringQueueSnapshot {
  assertSafeBoundary(boundary);
  assertActive(snapshot);
  const index = entryIndex(snapshot, steeringId);
  const entry = snapshot.entries[index];
  if (entry?.status === 'applied') {
    return snapshot;
  }
  if (entry?.status !== 'acknowledged') {
    throw new Error(`Steering message ${steeringId} must be acknowledged before application`);
  }
  if (snapshot.pending[0] !== steeringId) {
    throw new Error('Steering messages must be applied in queue order');
  }
  return {
    ...replaceEntry(snapshot, index, { ...entry, status: 'applied' }),
    pending: snapshot.pending.slice(1),
  };
}

export function closeSteeringQueue(
  snapshot: SteeringQueueSnapshot,
  lifecycle: Exclude<SteeringRunLifecycle, 'active'>,
): SteeringQueueSnapshot {
  if (snapshot.lifecycle === lifecycle) {
    return snapshot;
  }
  if (snapshot.lifecycle !== 'active') {
    throw new Error(`Steering queue is already ${snapshot.lifecycle}`);
  }
  const rejectionReason: SteeringRejectionReason =
    lifecycle === 'cancelled' ? 'run-cancelled' : 'run-terminal';
  return {
    ...snapshot,
    entries: snapshot.entries.map((entry) =>
      entry.status === 'received' || entry.status === 'acknowledged'
        ? { ...entry, rejectionReason, status: 'rejected' }
        : entry,
    ),
    lifecycle,
    pending: [],
  };
}
