/** Most tasks a workspace may have scheduled at once. */
export const MAX_SCHEDULED_TASKS = 20;
/** Shortest repeat. Anything faster is a polling loop, not a schedule. */
export const MIN_INTERVAL_MINUTES = 5;
/** Longest repeat: a week. */
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
/** Furthest ahead a one-off may be set: thirty days. */
export const MAX_ONCE_DELAY_MINUTES = 30 * 24 * 60;
/** A repeating task stops on its own after this many runs at most. */
export const MAX_RUNS_LIMIT = 100;
export const DEFAULT_MAX_RUNS = 10;
export const MAX_SCHEDULED_PROMPT_LENGTH = 2_000;
export const MAX_SCHEDULED_LABEL_LENGTH = 80;
export const MS_PER_MINUTE = 60_000;
/** How many upcoming gaps of a cron expression are checked against the minimum interval. */
export const CRON_MIN_GAP_CHECKS = 12;
/**
 * The longest a single timer may be asked to wait.
 *
 * `setTimeout` overflows at about 24.8 days and fires immediately, so a long
 * wait is broken into day-long sleeps. That is one wake-up a day at most, and
 * only while a task exists — not polling.
 */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1_000;
export const SCHEDULED_TASKS_STATE_KEY = 'clawAI.scheduledTasks';
