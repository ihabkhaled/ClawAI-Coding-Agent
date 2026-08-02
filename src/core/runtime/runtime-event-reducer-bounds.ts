import type { RuntimeEvent } from './runtime-protocol.schemas';
import type { RunBudget } from './runtime-tool-contracts';

const MAX_PROJECTION_BYTES = 131_072;
const MAX_TURNS = 100;
const MAX_INVOCATIONS = 500;
const MAX_STEERING_ENTRIES = 32;
const MAX_TIMELINE_EVENTS = 256;
const MAX_TIMELINE_BYTES = 524_288;

interface StatusProjection {
  readonly status: string;
}

export interface BoundedRuntimeProjection {
  readonly budget: { readonly limits: RunBudget } | undefined;
  readonly invocationOrder: readonly string[];
  readonly invocations: Readonly<Record<string, StatusProjection>>;
  readonly steering: Readonly<Record<string, StatusProjection>>;
  readonly steeringOrder: readonly string[];
  readonly turnOrder: readonly string[];
  readonly turns: Readonly<Record<string, StatusProjection>>;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function withoutEntry<T>(
  entries: Readonly<Record<string, T>>,
  key: string | undefined,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [entryKey, entry] of Object.entries(entries)) {
    if (entryKey !== key) next[entryKey] = entry;
  }
  return next;
}

function compactEntries<T extends StatusProjection>(input: {
  readonly capacity: number;
  readonly entries: Readonly<Record<string, T>>;
  readonly evictableStatuses: ReadonlySet<string>;
  readonly name: string;
  readonly order: readonly string[];
}): { readonly entries: Readonly<Record<string, T>>; readonly order: readonly string[] } {
  let entries = input.entries;
  const order = [...input.order];
  while (order.length > input.capacity || byteLength(entries) > MAX_PROJECTION_BYTES) {
    const index = order.findIndex((key) => {
      const entry = entries[key];
      return entry !== undefined && input.evictableStatuses.has(entry.status);
    });
    if (index < 0) {
      throw new Error(`Runtime ${input.name} projection exceeds its bounded capacity`);
    }
    const key = order[index];
    entries = withoutEntry(entries, key);
    order.splice(index, 1);
  }
  return { entries, order };
}

export function compactProjectionBounds<T extends BoundedRuntimeProjection>(projection: T): T {
  const turns = compactEntries({
    capacity: Math.min(projection.budget?.limits.maxModelTurns ?? MAX_TURNS, MAX_TURNS),
    entries: projection.turns,
    evictableStatuses: new Set(['completed', 'failed']),
    name: 'turns',
    order: projection.turnOrder,
  });
  const invocations = compactEntries({
    capacity: Math.min(projection.budget?.limits.maxToolCalls ?? MAX_INVOCATIONS, MAX_INVOCATIONS),
    entries: projection.invocations,
    evictableStatuses: new Set(['succeeded', 'failed', 'denied', 'cancelled', 'timed-out']),
    name: 'invocations',
    order: projection.invocationOrder,
  });
  const steering = compactEntries({
    capacity: MAX_STEERING_ENTRIES,
    entries: projection.steering,
    evictableStatuses: new Set(['applied', 'rejected']),
    name: 'steering',
    order: projection.steeringOrder,
  });
  return {
    ...projection,
    invocationOrder: invocations.order,
    invocations: invocations.entries,
    steering: steering.entries,
    steeringOrder: steering.order,
    turnOrder: turns.order,
    turns: turns.entries,
  };
}

export function compactTimeline(
  prior: readonly RuntimeEvent[],
  event: RuntimeEvent,
): readonly RuntimeEvent[] {
  const next = [...prior, event];
  while (next.length > MAX_TIMELINE_EVENTS || byteLength(next) > MAX_TIMELINE_BYTES) {
    next.shift();
  }
  if (next.length === 0) {
    throw new Error('Runtime timeline event exceeds its bounded capacity');
  }
  return next;
}
