/**
 * The bounds on waiting.
 *
 * A watcher with no ceiling is a run that never ends, and the budget that would
 * have stopped it counts model turns rather than wall clock. Ten minutes is
 * long enough for a test suite or a build to finish and short enough that a
 * mistaken wait costs one coffee rather than one afternoon.
 */
export const MAX_MONITOR_MS = 10 * 60 * 1000;
export const DEFAULT_MONITOR_MS = 60 * 1000;

/**
 * Polling starts responsive and slows down.
 *
 * A condition that resolves in a second should be noticed in a second, and one
 * that takes ten minutes should not cost two thousand stats to wait for. The
 * delay doubles from 250ms to a five-second ceiling, which is about 130 checks
 * across the whole maximum wait instead of 2,400 at a fixed quarter second.
 */
export const MIN_POLL_MS = 250;
export const MAX_POLL_MS = 5_000;
