/**
 * Only calls whose result is a pure function of the workspace can be judged
 * "repeated with nothing changed". Everything else (a process, a teammate, a
 * page, an HTTP endpoint, a plan) changes by itself over time, so polling it
 * with identical arguments is normal and must never count toward stuck.
 */
export const REPETITION_GUARDED_TOOL_PREFIX = 'workspace.';
export const REPETITION_GUARDED_TOOLS: readonly string[] = ['knowledge.context'];

export const REPETITION_NOTES_TOOL = 'workspace.notes';
/** A note to self: counted, but it does not start a new epoch (as in the SDK). */
export const REPETITION_NOTE_OPERATIONS: readonly string[] = ['add', 'replace', 'remove', 'clear'];
