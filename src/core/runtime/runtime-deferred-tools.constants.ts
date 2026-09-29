/**
 * F028 — which tools a run offers as deferred stubs instead of full schemas.
 *
 * Rarely used tools with heavy input schemas. Each is still declared at run
 * start (name, short description, and a hash commitment to its full
 * definition), so the backend can never admit one that was not declared; only
 * its schema waits until the model searches for it with `runtime.tool_search`.
 */
export const DEFERRED_RUNTIME_TOOL_NAMES: ReadonlySet<string> = new Set([
  'workspace.container',
  'workspace.database',
  'workspace.notebook',
  'workspace.services',
  'runtime.flagship',
  'runtime.integration',
  'runtime.schedule',
  'runtime.workflows',
  'runtime.board',
  'runtime.monitor',
  'runtime.worktree',
]);

export const TOOL_SEARCH_TOOL_NAME = 'runtime.tool_search';

/** The stub keeps the first sentence of a description, bounded to this. */
export const DEFERRED_STUB_DESCRIPTION_CHARACTERS = 200;

/** The most definitions one search loads; the backend accepts up to 16. */
export const TOOL_SEARCH_MAX_MATCHES = 5;
