/**
 * The client tool that turns a deferred stub into a callable tool. The name is
 * the backend's own (`RUNTIME_V2_TOOL_SEARCH_NAME` in claw-chat-service): its
 * deferred-catalog instruction and its "load it first" refusal both tell the
 * model to call this exact tool.
 */
export const DEFERRED_TOOL_SEARCH_NAME = 'runtime.tool_search';

/** The most definitions one search loads; the backend accepts up to 16. */
export const DEFERRED_SEARCH_MAX_MATCHES = 5;

/** A search query is at most this long. */
export const DEFERRED_SEARCH_QUERY_CHARS = 200;

/** Words shorter than this are not searched for. */
export const DEFERRED_SEARCH_MIN_TERM = 3;

/**
 * The tools `--defer-tools` sends as stubs: the ones a run often never touches.
 * The everyday four (file, command, git, notes) and the plan stay whole, so the
 * common task needs no extra turn.
 */
export const DEFAULT_DEFERRED_TOOLS: readonly string[] = [
  'agent.team',
  'browser.page',
  'http.request',
  'vision.describe',
  'knowledge.context',
  'workspace.shell',
  'code.gates',
  'process.watch',
];

/**
 * What the model reads about a tool it has not loaded: one line, written to say
 * WHEN to reach for it. A tool with no entry here falls back to the first
 * sentence of its description.
 */
export const DEFERRED_TOOL_SUMMARIES: Readonly<Record<string, string>> = {
  'agent.team':
    'Run sub-agents in parallel on independent parts of a big task, then wait for and verify them.',
  'browser.page':
    'Drive a headless browser page: open, snapshot, click, type, screenshot, console and network checks.',
  'http.request': 'Send one HTTP request to an allowed host to test an API; tokens stay hidden.',
  'vision.describe': 'Ask a vision model one question about an image file, such as a screenshot.',
  'knowledge.context':
    "Read the repository's own rules, skills and docs: task, index, search, read.",
  'workspace.shell': 'Run a script in a real shell (pipes, &&, redirects), operator-approved.',
  'code.gates': 'Run lint, typecheck, test, build or format and get short structured results.',
  'process.watch': 'Start and watch long-lived programs: a dev server, a push hook, watch tests.',
};

/** The search tool's description: short, because it is paid for on every turn. */
export const DEFERRED_TOOL_SEARCH_DESCRIPTION =
  'Load the full input schema of a tool marked deferred in the catalog. search {query}: a tool name ' +
  '(or keywords); matching tools become callable on your next turn. Lists the tools still deferred.';
