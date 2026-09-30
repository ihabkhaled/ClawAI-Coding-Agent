/** Mirrors agent-service `createScheduledCommandSchema`, tightened at the low end. */
export const MIN_ROUTINE_INTERVAL_MINUTES = 5;
export const MAX_ROUTINE_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_ROUTINE_NAME_LENGTH = 128;
export const MAX_ROUTINE_COMMAND_LENGTH = 4_096;

/** F099 prompt routines. Mirrors agent-service `createPromptRoutineSchema`. */
export const MAX_ROUTINE_PROMPT_LENGTH = 8_000;
export const MAX_ROUTINE_MODEL_LENGTH = 128;
export const MAX_ROUTINE_REPO_REF_LENGTH = 200;
export const MAX_ROUTINE_RUNNER_LABELS = 16;
export const ROUTINE_RUNNER_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,39}$/u;
