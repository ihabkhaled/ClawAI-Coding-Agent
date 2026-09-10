/**
 * A goal with fifty checks is a plan, not a completion condition.
 *
 * The point of acceptance checks is that a run can be held to them at the end,
 * which only works while a reader can hold all of them in mind at once. Beyond
 * about a dozen, the list stops being a test and starts being a document.
 */
export const MAX_GOAL_CHECKS = 12;
export const MAX_CHECK_LENGTH = 500;
export const MAX_GOAL_STATEMENT_LENGTH = 2_000;

/**
 * Waiving needs a reason at least this long.
 *
 * Without a floor, "n/a" clears any check and goal mode becomes a formality the
 * model satisfies by waiving everything. The floor does not make a reason good;
 * it makes an empty one visible.
 */
export const MIN_WAIVER_REASON_LENGTH = 20;
