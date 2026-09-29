/**
 * A branch name the runner's shell can take literally: git's own ref rules,
 * narrowed to characters that need no quoting in sh, cmd or PowerShell. A name
 * outside this set is refused rather than escaped, because escaping has to be
 * right for three shells and refusing only has to be right once.
 */
export const SAFE_BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![./])$/u;

/** The agent-service `POST agent/commands` limit on `command`. */
export const MAX_REMOTE_COMMAND_LENGTH = 4_096;

/** Terminal `TerminalCommandStatus` values: nothing further will happen. */
export const TERMINAL_CLOUD_TASK_STATUSES: ReadonlySet<string> = new Set([
  'REJECTED',
  'EXECUTED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
]);
