import type { RuntimeEvent } from './runtime-protocol.schemas';

export interface RuntimeEventIdentity {
  readonly fingerprint: string;
  readonly runId: string;
  readonly sequence: number;
}

export function runtimeEpochsMatch(
  left: RuntimeEvent['epochs'],
  right: RuntimeEvent['epochs'],
): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

export function canonicalizeRuntimeValue(value: unknown): string {
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
    return `[${value.map((entry) => canonicalizeRuntimeValue(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalizeRuntimeValue(entry)}`)
      .join(',')}}`;
  }
  throw new Error('Runtime event contains a non-serializable value');
}

export function runtimeEventsMatch(identity: RuntimeEventIdentity, event: RuntimeEvent): boolean {
  return identity.fingerprint === canonicalizeRuntimeValue(event);
}

export function isRuntimeEventReplay(
  identities: Readonly<Record<string, RuntimeEventIdentity>>,
  event: RuntimeEvent,
): boolean {
  const existing = identities[event.eventId];
  if (existing === undefined) return false;
  if (runtimeEventsMatch(existing, event)) return true;
  throw new Error(`Runtime event ${event.eventId} conflicts with an earlier event`);
}

export function compactRuntimeEventIdentities(
  existing: Readonly<Record<string, RuntimeEventIdentity>>,
  priorTimeline: readonly RuntimeEvent[],
  timeline: readonly RuntimeEvent[],
): Readonly<Record<string, RuntimeEventIdentity>> {
  const retained = new Set(timeline.map((entry) => entry.eventId));
  const next: Record<string, RuntimeEventIdentity> = {};
  for (const [eventId, identity] of Object.entries(existing)) {
    const belongsToPriorTimeline = priorTimeline.some((entry) => entry.eventId === eventId);
    if (!belongsToPriorTimeline || retained.has(eventId)) next[eventId] = identity;
  }
  return next;
}

export function withoutRuntimeRunIdentities(
  existing: Readonly<Record<string, RuntimeEventIdentity>>,
  runId: string | undefined,
): Readonly<Record<string, RuntimeEventIdentity>> {
  if (runId === undefined) return existing;
  const next: Record<string, RuntimeEventIdentity> = {};
  for (const [eventId, identity] of Object.entries(existing)) {
    if (identity.runId !== runId) next[eventId] = identity;
  }
  return next;
}
