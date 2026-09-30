import { GIT_WRITE_OPERATIONS } from './git-tools.constants';

/** How many recent calls a repeat is looked for in. */
export const REPEAT_WINDOW = 40;

/** The most calls the guard remembers for a run. */
export const REPEAT_HISTORY_MAX = 200;

/** The occurrence at which the call stops running and the model is told so. */
export const REPEAT_BLOCK_AT = 3;

/** The occurrence at which the note tells the model to stop reading. */
export const REPEAT_ESCALATE_AT = 5;

/** The occurrence at which the run ends as stuck. */
export const REPEAT_STUCK_AT = 8;

/** Read-only calls in a row before the model is nudged to start implementing. */
export const READ_STARVATION_FIRST = 40;

/** After the first nudge, one more every this many read-only calls. */
export const READ_STARVATION_EVERY = 10;

/** How much of a repeated read's earlier result is handed back. */
export const REPEAT_PREVIEW_LINES = 40;
export const REPEAT_PREVIEW_CHARS = 4_000;

/** How many earlier read results are kept for previews. */
export const REPEAT_CACHE_MAX = 50;

/** Read-category operations per tool; `workspace.notes` reading is a read too. */
export const READ_OPERATIONS: Readonly<Record<string, readonly string[]>> = {
  'workspace.file': ['read', 'list', 'glob', 'search', 'stat'],
  'workspace.notes': ['read'],
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

/** Argument names that say what a call is about, in the order they are tried. */
export const TARGET_ARGUMENTS: readonly string[] = ['path', 'pattern', 'query', 'regex', 'command'];

const STOP_TAIL =
  'Do not repeat it. Write what you learned to workspace.notes if useful, then take the NEXT step: create or update a file, run a command, or finish.';

/** The note on a call that was refused for being a repeat. */
export function repeatNote(times: number): string {
  return `You have made this exact call ${String(times)} times and nothing changed. The result is the same as before. ${STOP_TAIL}`;
}

/** The note once the repeats keep coming. */
export function escalatedNote(times: number): string {
  return `You have made this exact call ${String(times)} times and nothing changed. STOP reading. You must now write code or end the run with your report.`;
}

/** The note added to a result after a long run of reads. */
export const READING_TOO_LONG_NOTE =
  'You have made {count} read-only calls without changing anything. Decide, note your plan with workspace.notes add, and start implementing.';

/** The run's own message when it ended stuck. */
export const STUCK_ERROR_PREFIX = 'STUCK';

/** What a run that ended stuck is told when it continues. */
export const STUCK_CONTINUATION_LINE =
  'Your previous run got stuck repeating {what}. Do something different: stop looking at the same thing, use what your notes already say, and take a NEXT step that changes something (create or update a file, run a command) or finish with your report.';

/** The tail every continuation prompt shares: look at the workspace before acting. */
export const STUCK_PROMPT_TAIL =
  'Check the current state of the workspace (git status, the files you changed) before acting, and finish the remaining steps.';
