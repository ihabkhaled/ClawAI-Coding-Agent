/**
 * How many spans wait before a batch is sent, and how long one may wait.
 *
 * Both, not either. A size-only trigger holds the last few spans of a run
 * forever, so a failure that produced nine spans is never exported; a time-only
 * trigger sends a request per span during a busy run. The pair is what makes an
 * idle extension silent and a busy one bounded.
 */
export const OTLP_BATCH_SIZE = 64;
export const OTLP_FLUSH_INTERVAL_MS = 5_000;

/**
 * What the queue holds before it starts dropping.
 *
 * Dropping is the correct behaviour and the number is deliberately small. A
 * telemetry queue that grows without limit turns a collector outage into an
 * extension-host memory leak, and the spans worth keeping in that situation are
 * the recent ones, not the ones from before the collector went away.
 */
export const OTLP_MAX_QUEUED_SPANS = 512;

/** One export attempt, bounded so a hung collector cannot stall a run. */
export const OTLP_TIMEOUT_MS = 10_000;

/**
 * Attempts per export, and the first backoff between them.
 *
 * Retrying is what the OTLP specification asks for on 429, 502, 503 and 504,
 * and on a connection that failed outright. Bounded, because the next batch is
 * already queueing behind this one: three attempts cover a collector restart,
 * and past that the batch is worth less than the memory it holds.
 */
export const OTLP_MAX_ATTEMPTS = 3;
export const OTLP_RETRY_BASE_MS = 1_000;
export const OTLP_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** Finished-run usage records held for the metrics export, oldest dropped first. */
export const OTLP_MAX_QUEUED_RUNS = 128;
