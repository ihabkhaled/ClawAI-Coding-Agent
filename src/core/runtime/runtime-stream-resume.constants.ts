/**
 * How many consecutive transport failures the stream absorbs before the run
 * fails.
 *
 * A runtime run does not live in the SSE connection — it lives in the backend's
 * Redis state, and every stream is opened with `after=<cursor>`. Reopening
 * therefore loses nothing, which is why the follow loop already reopens when
 * the server closes the connection cleanly. A connection that *breaks* was the
 * one case treated as fatal, and the difference between the two is not
 * something the run should depend on.
 *
 * It broke a real commit. This repository runs its services in dev containers
 * that watch their own `src`, and the pre-commit hook rewrites staged files —
 * so `git commit` restarted chat-service, severed the stream, and killed the
 * run that had asked for the commit. The tool was still executing; the backend
 * came back four seconds later with the run intact; only the extension had
 * given up.
 *
 * Ten attempts over the delays below cover roughly three quarters of a minute.
 * Measured against the restart that caused this: nodemon reported four
 * consecutive restarts and the service answered again seventeen seconds after
 * the first, so a budget that only covered one restart would still have lost
 * the run. Beyond this the backend is not restarting, it is down.
 */
export const RUNTIME_STREAM_TRANSPORT_ATTEMPTS = 10;

/**
 * Backoff before each retry, in milliseconds.
 *
 * Front-loaded: a dropped connection is usually a restart, and the first two
 * attempts are cheap enough to catch a fast one before the user notices. The
 * last entry repeats for any attempt beyond the list.
 */
export const RUNTIME_STREAM_TRANSPORT_BACKOFF_MS: readonly number[] = [
  250, 500, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000, 8_000, 8_000,
];

/**
 * Backend error codes that mean "the service cannot reach its state store",
 * which is a transport condition wearing an application code.
 *
 * The run itself lives in Redis with an hour-long lease, so it survives a
 * service restart untouched; only the connection to it is gone. Keeping this
 * list closed matters — every other code the backend emits is a fact about the
 * run, and retrying one of those would replace a clear refusal with six silent
 * reconnects and the same refusal at the end.
 */
export const TRANSIENT_RUNTIME_STATE_CODES: readonly string[] = ['RUNTIME_STATE_UNAVAILABLE'];
