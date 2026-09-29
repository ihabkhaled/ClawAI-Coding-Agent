/** Mirrors agent-service `createScheduledCommandSchema`, tightened at the low end. */
export const MIN_ROUTINE_INTERVAL_MINUTES = 5;
export const MAX_ROUTINE_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_ROUTINE_NAME_LENGTH = 128;
export const MAX_ROUTINE_COMMAND_LENGTH = 4_096;
