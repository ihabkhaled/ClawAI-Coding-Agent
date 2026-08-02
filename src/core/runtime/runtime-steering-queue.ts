import { z } from 'zod';

import { RUNTIME_ID_PATTERN, RUNTIME_PROTOCOL_V2 } from './runtime-protocol.constants';

const MAX_STEERING_MESSAGE_BYTES = 32_768;
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

export function receiveSteering(
  snapshot: SteeringQueueSnapshot,
  value: unknown,
): SteeringQueueSnapshot {
  const message = steeringMessageSchema.parse(value);
  const digest = fingerprint(message);
  const sequenceDigest = snapshot.sequenceFingerprints[message.sequence];
  if (sequenceDigest !== undefined) {
    if (sequenceDigest === digest) {
      return snapshot;
    }
    throw new Error(
      `Steering sequence ${String(message.sequence)} conflicts with an earlier message`,
    );
  }
  const idempotencyDigest = snapshot.idempotencyFingerprints[message.idempotencyKey];
  if (idempotencyDigest !== undefined) {
    if (idempotencyDigest === digest) {
      return snapshot;
    }
    throw new Error(
      `Steering idempotency key ${message.idempotencyKey} conflicts with an earlier message`,
    );
  }
  const steeringDigest = snapshot.steeringFingerprints[message.steeringId];
  if (steeringDigest !== undefined) {
    if (steeringDigest === digest) {
      return snapshot;
    }
    throw new Error(`Steering identifier ${message.steeringId} conflicts with an earlier message`);
  }
  if (message.sequence !== snapshot.nextSequence) {
    throw new Error(
      `Steering sequence must be ${String(snapshot.nextSequence)} for run ${snapshot.runId}`,
    );
  }

  const rejectionReason = rejectionFor(snapshot, message);
  const entry: SteeringQueueEntry = {
    fingerprint: digest,
    message,
    ...(rejectionReason === undefined ? {} : { rejectionReason }),
    status: rejectionReason === undefined ? 'received' : 'rejected',
  };
  return {
    ...snapshot,
    entries: [...snapshot.entries, entry],
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
