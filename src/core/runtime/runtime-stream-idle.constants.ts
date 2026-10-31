/**
 * How long a run stream may carry only heartbeats before it counts as idle.
 *
 * The response lease already notices a stream that goes silent in bytes, and the
 * follow loop reopens it. A hung model or backend is different: the connection
 * stays healthy and keeps sending heartbeats forever, so nothing ever fires.
 * Only a real (non-heartbeat) event proves the run is making progress.
 *
 * Ten minutes is deliberately generous: a slow reasoning model can think for
 * minutes without emitting an event, and a false positive kills a healthy run.
 * A tool call in flight is never counted, because a long build or test run
 * legitimately produces no stream events while it executes.
 */
export const RUNTIME_STREAM_IDLE_MS = 600_000;

/** Heartbeat frame type the backend sends to keep the connection warm. */
export const RUNTIME_STREAM_HEARTBEAT_TYPE = 'HEARTBEAT';

/** Idle windows tolerated before giving up: the first re-attaches, the second fails. */
export const RUNTIME_STREAM_IDLE_STRIKES_BEFORE_FAILURE = 2;

/** The English text of the user-facing message; translated via `l10n.t`. */
export const RUNTIME_STREAM_IDLE_MESSAGE = 'The run stopped responding';
