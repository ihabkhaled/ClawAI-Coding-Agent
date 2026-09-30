import { RuntimeHttpError } from '../headless/runtime-http-error';

import { isServerBudgetError } from './server-budget';
import { RUN_GONE_PATTERN, RUN_NOT_FOUND_PATTERN } from './server-budget.constants';

/**
 * The runtime answered, and what it said is that it no longer has this run.
 *
 * A restart that lost the run's state, a claim that went stale and a run that
 * already ended all read this way. It is not an outage — asking again gets the
 * same answer — but the task is not over, so the caller continues it in a new
 * run. A spent server budget is also a 409 and has its own path, and a missing
 * thread is a 404 that stays a failure: only the run being unknown counts.
 */
export function isRunLostError(error: unknown): boolean {
  if (!(error instanceof RuntimeHttpError) || isServerBudgetError(error)) return false;
  if (error.status === 404) return RUN_NOT_FOUND_PATTERN.test(error.detail);
  return error.status === 409 && RUN_GONE_PATTERN.test(error.detail);
}
