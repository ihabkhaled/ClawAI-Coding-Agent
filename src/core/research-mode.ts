export const RESEARCH_MODES = ['NONE', 'SEARCH', 'SEARCH_FETCH', 'SEARCH_EXTRACT'] as const;

export type ResearchMode = (typeof RESEARCH_MODES)[number];
