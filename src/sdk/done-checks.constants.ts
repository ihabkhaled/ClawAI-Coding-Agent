/** A check that does not name its own limit may run this long. */
export const DONE_CHECK_DEFAULT_TIMEOUT_MS = 600_000;

/** The longest a check may be given. */
export const DONE_CHECK_MAX_TIMEOUT_MS = 3_600_000;

/** Characters of output kept per check, head and tail together. */
export const DONE_CHECK_OUTPUT_CHARS = 3_000;

/** The most checks one agent may carry. */
export const DONE_CHECK_MAX_COUNT = 20;

/** The longest label. */
export const DONE_CHECK_MAX_LABEL_CHARS = 80;

/** The most arguments one check may carry. */
export const DONE_CHECK_MAX_ARGUMENTS = 100;

/** The error code of a run whose completion checks still fail when the continuations are gone. */
export const DONE_CHECKS_FAILED_CODE = 'DONE_CHECKS_FAILED';

/** Why a run was continued: the orchestrator's completion checks failed. */
export const DONE_CHECKS_REASON = 'checks-failed' as const;

/** The start of the prompt that follows a failed completion check. */
export const DONE_CHECKS_PROMPT_HEAD =
  "You reported the task as done, but the orchestrator's completion checks failed. Do NOT declare done until every check passes.";

/** The end of that prompt. */
export const DONE_CHECKS_PROMPT_TAIL = 'Fix the real cause, then finish.';

/** The exit code recorded for a check that did not exit: timed out, cancelled or never started. */
export const DONE_CHECK_NO_EXIT_CODE = -1;

/** Characters of a failing check's output (its end) that the `run.checks` event carries. */
export const DONE_CHECK_EVENT_TAIL_CHARS = 600;

/** The start of the prompt that follows the same checks failing with the same output twice running. */
export const DONE_CHECKS_STUCK_HEAD =
  'The same completion checks failed with identical output twice in a row, so your current approach is not working. Stop repeating it and take a DIFFERENT approach: re-read the failing output below, question your assumptions, and change what you do.';
