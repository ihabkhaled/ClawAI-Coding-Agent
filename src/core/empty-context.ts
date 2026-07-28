import type { CollectedContext } from './context-collector';

export const EMPTY_CONTEXT: CollectedContext = {
  files: [],
  receipt: {
    included: [],
    excluded: [],
    totalBytes: 0,
    truncated: false,
  },
};
