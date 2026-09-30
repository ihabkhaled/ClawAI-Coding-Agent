/** The longest operator instruction text a run accepts, in characters. */
export const AGENT_MAX_SYSTEM_PROMPT_CHARS = 20_000;

/** What a thread identifier may look like; anything else never reaches a URL. */
export const AGENT_THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

/** The most tool patterns one allow or deny list may hold. */
export const AGENT_MAX_TOOL_PATTERNS = 100;

/** The longest single tool pattern, in characters. */
export const AGENT_MAX_TOOL_PATTERN_CHARS = 200;

/** Frames the operator instructions so the model can tell them from the task. */
export const AGENT_INSTRUCTIONS_OPEN = '<operator-instructions>';
export const AGENT_INSTRUCTIONS_CLOSE = '</operator-instructions>';

/** Named in logs where the instruction text itself must not appear. */
export const AGENT_REDACTED_PROMPT_MARK = '[redacted-instructions]';
