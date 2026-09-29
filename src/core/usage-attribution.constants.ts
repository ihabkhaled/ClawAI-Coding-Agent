/**
 * How many distinct sources or models one session keeps apart.
 *
 * Bounded so a session that runs hundreds of differently named sub-agents
 * cannot grow the ledger without limit; past the cap the rest share one line.
 */
export const USAGE_ATTRIBUTION_MAX_DIMENSIONS = 50;

export const USAGE_ATTRIBUTION_OVERFLOW = 'other';

export const USAGE_ATTRIBUTION_AUTO_MODEL = 'auto';
