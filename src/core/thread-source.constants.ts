import type { ThreadOrigin, ThreadSource } from './thread-source.types';

/**
 * The origin each surface writes. VS Code and the CLI deliberately share
 * `CODING_AGENT`: one origin is one history, so a run started from a terminal
 * is listed and resumable in the editor and the other way round.
 */
export const THREAD_ORIGIN_BY_SOURCE: Readonly<Record<ThreadSource, ThreadOrigin>> = {
  vscode: 'CODING_AGENT',
  cli: 'CODING_AGENT',
  web: 'WEB',
};
