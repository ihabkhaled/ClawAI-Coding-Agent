/** Shortest wait before a foreground command may yield; below this it is not worth a handoff. */
export const COMMAND_YIELD_AFTER_MS_MIN = 1_000;

/** Longest wait before yielding; past ten minutes the caller should use background instead. */
export const COMMAND_YIELD_AFTER_MS_MAX = 600_000;
