/** Normal gap between two inbox reads. */
export const CHANNEL_POLL_INTERVAL_MS = 60_000;

/** Ceiling for the exponential backoff after failed reads. */
export const CHANNEL_MAX_BACKOFF_MS = 15 * 60_000;

/** A watch stops after this many failed reads in a row, until the user restarts it. */
export const CHANNEL_MAX_CONSECUTIVE_FAILURES = 5;

/** A watch session ends after this many reads (4 hours at the normal gap); restarting begins a new one. */
export const CHANNEL_MAX_POLLS_PER_SESSION = 240;

/** Messages read per poll. */
export const CHANNEL_READ_LIMIT = 10;

/** Set once the user has asked for their webhook, so the watch starts on its own afterwards. */
export const CHANNEL_ENABLED_MEMORY_KEY = 'clawAI.channels.enabled';
