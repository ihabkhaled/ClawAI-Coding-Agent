/** The Conventional Commits types a title may start with. */
export const CONVENTIONAL_TYPES = [
  'feat',
  'fix',
  'docs',
  'test',
  'refactor',
  'perf',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
] as const;

/** A pull request title GitHub renders in full in every list. */
export const MAX_PULL_REQUEST_TITLE = 72;

/** gh accepts far more, but a description past this is a log, not a summary. */
export const MAX_PULL_REQUEST_BODY = 20_000;

/** Failed-job log kept per run: the tail, which is where the failure is. */
export const MAX_FAILURE_LOG_CHARS = 12_000;

/** Runs whose logs are fetched for one failure; more is noise for a fix prompt. */
export const MAX_FAILURE_RUNS = 3;

/**
 * How a watched pull request is polled.
 *
 * Backoff doubles from the first delay to the ceiling, and polling stops after
 * the poll limit whatever the checks say: a CI that has not finished in that
 * window is one a person should look at, and an unbounded poll is a quiet
 * network cost nobody agreed to.
 */
export const PULL_REQUEST_MONITOR_POLICY = {
  firstDelayMs: 30_000,
  maxDelayMs: 300_000,
  maxPolls: 24,
  maxConsecutiveErrors: 3,
  maxWatched: 5,
} as const;
