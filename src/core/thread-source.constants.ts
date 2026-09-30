import type { ThreadOrigin, ThreadSource, ThreadSurface } from './thread-source.types';

/**
 * The origin each surface writes (F094). The CLI has its own origin so history
 * can say where a thread began, but it is still one history: the backend lists
 * `CODING_AGENT_CLI` threads whenever `CODING_AGENT` is asked for, so a run
 * started from a terminal is listed and resumable in the editor and the other
 * way round.
 */
export const THREAD_ORIGIN_BY_SOURCE: Readonly<Record<ThreadSource, ThreadOrigin>> = {
  vscode: 'CODING_AGENT',
  cli: 'CODING_AGENT_CLI',
  web: 'WEB',
};

/**
 * What the CLI writes to a backend that predates `CODING_AGENT_CLI` and rejects
 * it as an unknown origin: the shared agent origin it used before.
 */
export const LEGACY_CLI_THREAD_ORIGIN: ThreadOrigin = 'CODING_AGENT';

/** How each stored origin reads back as a surface. Anything else is web. */
export const THREAD_SURFACE_BY_ORIGIN: Readonly<Record<string, ThreadSurface>> = {
  CODING_AGENT: 'agent',
  CODING_AGENT_CLI: 'cli',
};
