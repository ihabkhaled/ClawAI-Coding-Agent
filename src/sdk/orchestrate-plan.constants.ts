import type { AgentToolCategory } from './workspace-toolkit.types';

/** The version of the plan format; a plan file may not name another. */
export const ORCHESTRATE_PLAN_VERSION = 1;

/** Stage ids and agent names: lower case words, so they are safe in paths, events and reports. */
export const ORCHESTRATE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/u;
export const ORCHESTRATE_STAGE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

export const ORCHESTRATE_MAX_STAGES = 20;
export const ORCHESTRATE_MAX_AGENTS = 32;
export const ORCHESTRATE_MAX_PARALLEL = 8;
export const ORCHESTRATE_DEFAULT_PARALLEL = 2;
export const ORCHESTRATE_MAX_CHECKS = 10;
export const ORCHESTRATE_MAX_GLOBS = 16;
export const ORCHESTRATE_MAX_HOSTS = 16;
export const ORCHESTRATE_MAX_TIMEOUT_SEC = 86_400;
export const ORCHESTRATE_MAX_POOLS = 8;
export const ORCHESTRATE_MAX_POOL_MODELS = 8;
export const ORCHESTRATE_TASK_MAX_CHARS = 7_000;
export const ORCHESTRATE_GOAL_MAX_CHARS = 2_000;

/** `onFailure`: stop at the first failed stage, keep going on independent stages, or retry an agent N times first. */
export const ORCHESTRATE_FAILURE_PATTERN = /^(?:stop|continue|retry:[1-3])$/u;

/** A model written `pool:<name>` is picked from `modelPools.<name>`. */
export const ORCHESTRATE_POOL_PREFIX = 'pool:';

export const ORCHESTRATE_MODEL_PATTERN =
  /^(?:pool:[a-z][a-z0-9-]{0,23}|[A-Za-z0-9][A-Za-z0-9._:/-]{0,79})$/u;
export const ORCHESTRATE_POOL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,23}$/u;

/** The categories a plan agent may ask for. `shell` is the `shell: true` switch; `agents` and `mcp` are not offered. */
export const ORCHESTRATE_AGENT_CATEGORIES = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'http',
  'http-write',
  'browser',
] as const;

/** What a run grants when the operator names nothing: local work, no network, no shell. */
export const ORCHESTRATE_DEFAULT_CEILING: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
];

/** Categories that change files, so two of them running together need disjoint scopes. */
export const ORCHESTRATE_WRITING: readonly AgentToolCategory[] = [
  'write',
  'git-write',
  'command',
  'shell',
];

/** The folder under the state directory that holds every run's report. */
export const ORCHESTRATE_DIRECTORY = 'orchestrate';

/** How much of an agent's own final report and of a check's output the report keeps. */
export const ORCHESTRATE_SUMMARY_CHARS = 1_500;
export const ORCHESTRATE_TAIL_CHARS = 600;

/** After a halt, how long the engine waits for a runner to stop before it counts the agent cancelled. */
export const ORCHESTRATE_HALT_GRACE_MS = 15_000;
