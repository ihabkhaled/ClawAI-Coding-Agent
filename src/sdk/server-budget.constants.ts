/** The failure code the runtime reports when a run used up its server-side budget. */
export const SERVER_BUDGET_EXHAUSTED_CODE = 'RUNTIME_BUDGET_EXHAUSTED';

/**
 * A phrase of the 409 refusal the runtime returns for the tool result that hit
 * the budget, for a body that carries the message but not the code.
 */
export const SERVER_BUDGET_EXHAUSTED_TEXT = 'allowed tool calls';

/** The most continuations `autoContinue` accepts. */
export const AUTO_CONTINUE_MAX = 20;

/** The part of a continuation prompt that makes the model re-check its work before acting. */
const CONTINUATION_TAIL =
  'Continue the task from where you stopped: check the current state of the workspace (git status, the files you changed) before acting, and finish the remaining steps.';

/** What a continuation run is told, so it re-checks the workspace before acting. */
export const CONTINUATION_PROMPT = `Your previous run ended because its budget was used up. ${CONTINUATION_TAIL}`;

/** What a run is told when the runtime lost the previous one, for instance in a restart. */
export const RUN_LOST_PROMPT = `Your previous run was interrupted because the runtime lost track of it (for example, it restarted). Some of your tool calls may already have taken effect. ${CONTINUATION_TAIL}`;

/** Why a run was continued: its server budget was used up. */
export const CONTINUATION_REASON = 'budget-exhausted';

/** Why a run was continued: the runtime no longer knew the run. */
export const RUN_LOST_REASON = 'run-lost';

/** What a run is told when its sign-in expired mid-run and a fresh one was made. */
export const SESSION_EXPIRED_PROMPT = `Your sign-in expired during the previous run and was renewed. Some of your tool calls may already have taken effect. ${CONTINUATION_TAIL}`;

/** Why a run was continued: the access token expired. */
export const SESSION_EXPIRED_REASON = 'session-expired';

/** A 404 body that says the run itself is unknown, as opposed to the thread or a file. */
export const RUN_NOT_FOUND_PATTERN = /RUNTIME_RUN_NOT_FOUND|run was not found/iu;

/** A 409 body that says the run is over or was never claimed by this caller. */
export const RUN_GONE_PATTERN = /RUN_TERMINAL|NOT_CLAIMED|STALE_CLAIM/u;

/** Shares of the result budget, highest first, at which a tool result carries a note. */
export const RESULT_BUDGET_NOTE_LEVELS: readonly number[] = [0.9, 0.75];
