import type { RemoteCommandLoopOptions } from './remote-command-loop.types';

/**
 * Poll every 5 s while healthy, double on failure up to 60 s, and stop after
 * eight failures in a row rather than hammering a backend that is down.
 * A heartbeat every 12 polls (about a minute) keeps the 120 s session alive.
 */
export const REMOTE_COMMAND_LOOP_DEFAULTS: RemoteCommandLoopOptions = {
  pollIntervalMs: 5_000,
  maxBackoffMs: 60_000,
  maxConsecutiveFailures: 8,
  heartbeatEveryPolls: 12,
};

/** The backend accepts at most 64 KiB per stream on completion. */
export const REMOTE_OUTPUT_LIMIT = 65_536;

/** Exit code reported for a command this machine refused to run. */
export const REMOTE_REFUSED_EXIT_CODE = 126;
