/**
 * The ten stage behaviours the flagship lane knows how to run, in the order a
 * delivery runs them when it declares no stage list of its own.
 *
 * A stage *kind* is behaviour, not vocabulary: the stage adapter branches on
 * four of them (authorize, implement, integrate, commit) and hands every other
 * kind to a sub-agent with a role and a tool set. A goal can therefore name its
 * own stages, but each one must say which of these behaviours it runs.
 */
export const FLAGSHIP_STAGE_KINDS = [
  'discover',
  'plan',
  'authorize',
  'implement',
  'integrate',
  'verify',
  'review',
  'commit',
  'publish-ready',
  'report',
] as const;

/** Bounds on a goal-declared stage list. */
export const FLAGSHIP_MIN_STAGES = 1;
export const FLAGSHIP_MAX_STAGES = 20;
export const FLAGSHIP_MAX_STAGE_ACCEPTANCE_CHECKS = 20;
export const FLAGSHIP_STAGE_ID_MIN_LENGTH = 2;
export const FLAGSHIP_STAGE_ID_MAX_LENGTH = 60;

/** The sub-agent acceptance-check ceiling; the stage merge never exceeds it. */
export const FLAGSHIP_MAX_TASK_ACCEPTANCE_CHECKS = 200;

/**
 * Kinds a stage list may use at most once.
 *
 * Each of these either carries trusted host state (the plan graph, the effect
 * boundary, the integrated commits) or is the target of a replan. Two plan
 * stages would make "go back to planning" ambiguous, and a second integrate
 * would re-integrate commits the first already cleared.
 */
export const FLAGSHIP_SINGLE_USE_STAGE_KINDS: readonly string[] = [
  'plan',
  'authorize',
  'implement',
  'integrate',
  'commit',
];

/**
 * Kinds that must appear earlier in the list before a given kind may run.
 *
 * These are the security invariants of the default order, restated so a custom
 * order cannot skip them: nothing is implemented before it is planned and its
 * effect boundary authorized, nothing is integrated that was not implemented,
 * and the host never reports a commit it did not integrate.
 */
export const FLAGSHIP_STAGE_PREREQUISITES: Readonly<Record<string, readonly string[]>> = {
  implement: ['plan', 'authorize'],
  integrate: ['implement'],
  commit: ['integrate'],
};

/** Kinds that must appear LATER in the list whenever the given kind is present. */
export const FLAGSHIP_STAGE_FOLLOW_UPS: Readonly<Record<string, readonly string[]>> = {
  implement: ['verify'],
};

/** A lowercase slug: letters and digits with single hyphens between them. */
export const FLAGSHIP_STAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
