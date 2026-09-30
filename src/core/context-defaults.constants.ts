/**
 * What the editor reads into context when no setting says otherwise.
 *
 * Shared so the command-line agent builds the same context as the editor does
 * rather than a second, slightly different one.
 */
export const DEFAULT_CONTEXT_EXCLUDES: readonly string[] = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.env*',
  '**/*secret*',
  '**/*credential*',
];

export const DEFAULT_MAX_CONTEXT_FILES = 40;
export const DEFAULT_MAX_CONTEXT_BYTES = 200_000;
