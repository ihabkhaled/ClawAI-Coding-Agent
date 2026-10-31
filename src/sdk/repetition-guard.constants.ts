import { GIT_WRITE_OPERATIONS } from './git-tools.constants';

/** Read-category operations per tool; `workspace.notes` reading is a read too. */
export const READ_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  'workspace.file': ['read', 'list', 'glob', 'search', 'stat'],
  'workspace.notes': ['read'],
  'task.plan': ['list', 'next'],
  // Output changes between calls, so a repeat is only a repeat when the cursor repeats too.
  'process.watch': ['status', 'list', 'output'],
  'knowledge.context': ['index', 'read', 'search', 'task'],
  'workspace.git': ['status', 'diff', 'log', 'show', 'remote', 'branch'],
};

/** Operations that only touch the agent's own notes: progress, but no change to the workspace. */
export const NOTE_OPERATIONS: readonly string[] = ['add', 'replace', 'remove', 'clear'];

/** The tool whose every call counts as a change to the workspace. */
export const COMMAND_TOOL_NAME = 'workspace.command';

export const GIT_TOOL_NAME = 'workspace.git';

export const NOTES_TOOL_NAME = 'workspace.notes';

/** Git operations that change the repository. */
export const GIT_CHANGING_OPERATIONS: readonly string[] = GIT_WRITE_OPERATIONS;
