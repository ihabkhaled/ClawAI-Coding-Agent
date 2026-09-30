/**
 * Files a Runtime V2 tool result may name for the next model turn (F030).
 *
 * Must match claw-chat-service `RUNTIME_V2_MAX_RESULT_FILE_IDS` and its id
 * bound: the backend rejects a result outside them.
 */
export const MAX_TOOL_RESULT_FILE_IDS = 4;
export const TOOL_RESULT_FILE_ID_CHARACTERS = 200;
