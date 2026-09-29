import type { HeadlessExitCode, HeadlessOutcome } from './headless-outcome.types';

/**
 * The exit-code contract, in one place because it is a promise to callers.
 *
 * Changing a number here changes the meaning of a pipeline someone already
 * wrote, so the table is written down rather than computed at the call site.
 *
 * `130` for a cancelled run is the shell's own convention for a process ended
 * by SIGINT (128 + 2), so a pipeline that already handles Ctrl-C handles this.
 */
export const HEADLESS_EXIT_CODES: Readonly<Record<HeadlessOutcome, HeadlessExitCode>> = {
  completed: 0,
  failed: 1,
  unusable: 2,
  unauthenticated: 3,
  blocked: 4,
  exhausted: 5,
  cancelled: 130,
};

/** HTTP statuses that mean the credential, not the request, was refused. */
export const HEADLESS_AUTH_STATUSES: readonly number[] = [401];
