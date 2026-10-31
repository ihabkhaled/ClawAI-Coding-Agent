import type { BackendRetryClass } from './backend-retry.types';

/**
 * How long the panel keeps trying. A read sits behind a visible spinner, so it
 * gives up fast; a run command hands the run back to the platform, and losing
 * it loses the turn, so it keeps trying through a short outage.
 */
export const BACKEND_RETRY_ALLOWANCE: Readonly<
  Record<BackendRetryClass, { readonly maxAttempts: number; readonly budgetMs: number }>
> = {
  read: { maxAttempts: 3, budgetMs: 20_000 },
  command: { maxAttempts: 8, budgetMs: 120_000 },
  start: { maxAttempts: 4, budgetMs: 60_000 },
};

/**
 * Run start is narrower than `command`: the server mints a fresh messageId per
 * HTTP call and fingerprints it, so a repeat of a start that was admitted is a
 * 409 conflict and orphans the first run. Only a refusal that proves nothing
 * was admitted may be repeated: a 429 (rejected before the run is created).
 */
export const START_SAFE_STATUSES: readonly number[] = [429];

/** Transport failures that happen before a connection exists, so nothing reached the server. */
export const START_SAFE_CODES: readonly string[] = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
