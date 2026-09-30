import type { ResearchMode } from '../core/research-mode';

/**
 * Which web operations each research mode offers the model.
 *
 * The runtime run request has no research field, so the mode cannot be sent to
 * the server in this path; it decides which web tools the agent is offered, and
 * that is all it does here. Crawl belongs to Search + fetch because the web app
 * turns a fetch into a crawl when the message says "crawl"; extract is the
 * extra that Search + extract adds.
 */
export const WEB_RESEARCH_MODE_OPERATIONS: Readonly<Record<ResearchMode, readonly string[]>> = {
  NONE: [],
  SEARCH: ['search'],
  SEARCH_FETCH: ['search', 'fetch', 'crawl'],
  SEARCH_EXTRACT: ['search', 'fetch', 'crawl', 'extract'],
};

/** The spellings `--research` accepts, each mapped to the editor's research mode. */
export const AGENT_RESEARCH_FLAG_VALUES: Readonly<Record<string, ResearchMode>> = {
  none: 'NONE',
  search: 'SEARCH',
  'search-fetch': 'SEARCH_FETCH',
  'search-extract': 'SEARCH_EXTRACT',
};
