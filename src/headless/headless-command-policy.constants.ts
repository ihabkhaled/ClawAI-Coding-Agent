/**
 * The commands a headless run may spawn unless the caller widens the set.
 *
 * Small on purpose. A run nobody is watching chooses its own commands, and the
 * default should be the ones a coding task genuinely needs rather than whatever
 * happens to be on PATH. Widening is a decision the person scheduling the run
 * makes, in the invocation, where it can be reviewed.
 */
export const HEADLESS_DEFAULT_EXECUTABLES: readonly string[] = ['node', 'npm', 'npx'];
