/**
 * Result keys that carry an exit status, most specific first.
 *
 * A command's exit code is the single most useful thing a run can report about
 * it, and it is the one thing a byte count cannot imply: a failing build and a
 * passing one produce output of much the same size.
 */
export const TOOL_EXIT_KEYS: readonly string[] = ['exitCode', 'exit', 'code', 'status'];

/**
 * Result keys that explain a refusal.
 *
 * A tool that declined and a tool that succeeded quietly both finish in a few
 * milliseconds with almost no output, so without the reason they read the same.
 */
export const TOOL_REASON_KEYS: readonly string[] = ['reason', 'error', 'message'];

/** How long a reason may be before it is shortened for a single line. */
export const TOOL_REASON_MAX_LENGTH = 90;
