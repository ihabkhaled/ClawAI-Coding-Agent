import type { HeadlessExitCode, HeadlessOutcome } from './headless-outcome.types';

/**
 * The exit-code contract, in one place because it is a promise to callers.
 *
 * Changing a number here changes the meaning of a pipeline someone already
 * wrote, so the table is written down rather than computed at the call site.
 */
export const HEADLESS_EXIT_CODES: Readonly<Record<HeadlessOutcome, HeadlessExitCode>> = {
  completed: 0,
  failed: 1,
  unusable: 2,
  blocked: 3,
  cancelled: 4,
  exhausted: 5,
};
