/**
 * The one list of events that end a run.
 *
 * The follow loop, the reducer, `isRuntimeRunEnded` and the headless runner all
 * read this list. They used to keep four copies, and the follow loop's copy
 * lacked `run.blocked`: a denied tool ended the run everywhere except in the
 * loop that was reading the stream, which then waited out the idle windows.
 */
export const RUNTIME_TERMINAL_EVENT_TYPES = [
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.blocked',
] as const;

export type RuntimeTerminalEventType = (typeof RUNTIME_TERMINAL_EVENT_TYPES)[number];

/** The status the reducer records for each terminal event. */
export const RUNTIME_TERMINAL_STATUS_BY_EVENT: Readonly<
  Record<RuntimeTerminalEventType, 'blocked' | 'cancelled' | 'completed' | 'failed'>
> = {
  'run.blocked': 'blocked',
  'run.cancelled': 'cancelled',
  'run.completed': 'completed',
  'run.failed': 'failed',
};
