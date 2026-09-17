/**
 * Commands excluded from the sweep, and why.
 *
 * `Export Transcript` opens a native save dialog. Nothing in the page can
 * dismiss one, so the window stops responding to automation for the rest of the
 * session and every later command reports a false failure. Its refusal message
 * is asserted separately; what is untested is the dialog itself.
 */
export const COMMANDS_NEEDING_A_DIALOG: readonly string[] = ['Export Transcript'];

/**
 * How many commands one editor is asked to run.
 *
 * Twenty-three is where a single editor stops responding, whichever commands
 * those are. Twelve leaves room for the palette interactions each test makes
 * on top of the invocation itself.
 */
export const COMMANDS_PER_EDITOR = 12;
