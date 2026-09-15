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
