/** How many directory entries are scanned per context file wanted; the editor uses the same factor. */
export const AGENT_CONTEXT_SCAN_MULTIPLIER = 10;

/** Directories never entered while listing the workspace. */
export const AGENT_CONTEXT_SKIPPED_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
];
