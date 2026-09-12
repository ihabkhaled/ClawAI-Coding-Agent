import { z } from 'zod';

import { MAX_MONITOR_MS, MAX_POLL_MS, MIN_POLL_MS } from './monitor-condition.constants';

import type { MonitorCondition, MonitorObservation } from './monitor-condition.types';

export const monitorConditionSchema = z
  .object({
    kind: z.enum(['exists', 'missing', 'matches', 'changed']),
    path: z.string().trim().min(1).max(1_000),
    pattern: z.string().min(1).max(1_000).optional(),
    timeoutMs: z.number().int().min(1_000).max(MAX_MONITOR_MS).default(60_000),
  })
  .refine((value) => value.kind !== 'matches' || value.pattern !== undefined, {
    message: 'a matches condition needs a pattern',
  });

/**
 * How long to wait before looking again.
 *
 * Backoff rather than a fixed interval, because the two things being waited for
 * have very different shapes. A file a command is about to write appears within
 * a second and should be noticed within a second. A test suite takes minutes,
 * and checking it four times a second for all of them is two thousand stats
 * spent to learn nothing.
 */
export function nextPollDelay(previousDelayMs: number): number {
  const doubled = previousDelayMs <= 0 ? MIN_POLL_MS : previousDelayMs * 2;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, doubled));
}

/**
 * Whether what the run is waiting for has happened.
 *
 * `changed` is answered against the digest taken when the wait began, not
 * against the previous poll: a file written twice while nobody was looking has
 * still changed, and comparing consecutive polls would miss the second write
 * landing between them.
 *
 * A pattern that does not compile makes the condition unsatisfiable rather than
 * throwing here. The tool refuses it up front, where a caller can be told what
 * was wrong with it; a throw from inside the wait loop would surface as a
 * failed run minutes after the mistake.
 */
export function isConditionMet(
  condition: MonitorCondition,
  baseline: MonitorObservation,
  current: MonitorObservation,
): boolean {
  if (condition.kind === 'exists') return current.exists;
  if (condition.kind === 'missing') return !current.exists;
  if (condition.kind === 'changed') {
    return current.exists !== baseline.exists || current.digest !== baseline.digest;
  }
  if (!current.exists || condition.pattern === undefined) return false;
  const text = current.text ?? '';
  try {
    return new RegExp(condition.pattern, 'u').test(text);
  } catch {
    return false;
  }
}

/** Refuses a pattern the engine cannot run, before anything starts waiting. */
export function assertMonitorPattern(pattern: string | undefined): void {
  if (pattern === undefined) return;
  try {
    void new RegExp(pattern, 'u');
  } catch {
    throw new Error('monitor pattern is not a valid regular expression');
  }
}
