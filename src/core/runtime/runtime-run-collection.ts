const MAX_RETAINED_RUNS = 32;

interface RuntimeRunStatusRecord {
  readonly lastSequence: number;
  readonly runId: string;
  readonly status: string;
}

export interface RuntimeRunCollection<T extends RuntimeRunStatusRecord> {
  readonly evictedRunId: string | undefined;
  readonly order: readonly string[];
  readonly runs: Readonly<Record<string, T>>;
}

function withoutRun<T>(runs: Readonly<Record<string, T>>, runId: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, run] of Object.entries(runs)) {
    if (key !== runId) next[key] = run;
  }
  return next;
}

export function admitRuntimeRunCollection<T extends RuntimeRunStatusRecord>(
  runs: Readonly<Record<string, T>>,
  order: readonly string[],
  runId: string,
): RuntimeRunCollection<T> {
  if (runs[runId] !== undefined) return { evictedRunId: undefined, order, runs };
  if (order.length < MAX_RETAINED_RUNS) {
    return { evictedRunId: undefined, order: [...order, runId], runs };
  }
  const evictedRunId = order.find((candidate) => runs[candidate]?.status !== 'running');
  if (evictedRunId === undefined) {
    throw new Error('Runtime run collection exceeds its bounded capacity');
  }
  return {
    evictedRunId,
    order: [...order.filter((candidate) => candidate !== evictedRunId), runId],
    runs: withoutRun(runs, evictedRunId),
  };
}

export function selectActiveRuntimeRun<T extends RuntimeRunStatusRecord>(
  priorActiveRunId: string | undefined,
  eventRunId: string,
  runs: Readonly<Record<string, T>>,
): string | undefined {
  if (runs[eventRunId]?.status === 'running') return eventRunId;
  if (priorActiveRunId !== undefined && runs[priorActiveRunId]?.status === 'running') {
    return priorActiveRunId;
  }
  const candidates = Object.values(runs).filter((run) => run.status === 'running');
  candidates.sort(
    (left, right) =>
      right.lastSequence - left.lastSequence || left.runId.localeCompare(right.runId),
  );
  return candidates[0]?.runId;
}
