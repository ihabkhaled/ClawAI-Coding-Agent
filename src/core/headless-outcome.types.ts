/** How a non-interactive run ended, in terms a pipeline can act on. */
export type HeadlessOutcome =
  'completed' | 'failed' | 'unusable' | 'blocked' | 'cancelled' | 'exhausted';

/** The process exit codes this runner promises. */
export type HeadlessExitCode = 0 | 1 | 2 | 3 | 4 | 5;
