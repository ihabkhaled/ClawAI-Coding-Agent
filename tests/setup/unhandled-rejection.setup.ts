import { afterEach } from 'vitest';

import {
  describeRejection,
  installUnhandledRejectionGuard,
  takeUnhandledRejections,
} from '../helpers/unhandled-rejection-guard';

/**
 * The 1.84.0 CI failure was a promise nobody awaited. Vitest reports those at
 * the end of the run without saying which test leaked it; this fails the test
 * that was running when it happened.
 */
installUnhandledRejectionGuard();

afterEach(async () => {
  // A rejection is reported on the next macrotask after the promise is dropped.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const leaked = takeUnhandledRejections();
  if (leaked.length > 0) {
    throw new Error(`Unhandled promise rejection: ${leaked.map(describeRejection).join('; ')}`);
  }
});
