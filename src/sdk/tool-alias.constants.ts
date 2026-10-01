/** Prefixes the docs and models put before a workspace tool's short name. */
export const TOOL_ALIAS_PREFIXES: readonly string[] = ['workspace', 'workspaces'];

/** What separates the parts of a near-miss tool name: `workspace.file.read`, `workspace_file_read`. */
export const TOOL_ALIAS_SEPARATOR = /[._/\-:]+/u;

/** The error code the runtime reports when the model names a tool that was not offered. */
export const UNKNOWN_TOOL_PATTERN = /unknown[\s_-]*tool|tool[\s_-]*not[\s_-]*(?:found|offered)/iu;

/** Why a run was continued: the model named a tool that does not exist. */
export const UNKNOWN_TOOL_REASON = 'unknown-tool' as const;

/** The start of the prompt that follows an unknown-tool failure. */
export const UNKNOWN_TOOL_PROMPT_HEAD =
  'Your previous run ended because you called a tool name that does not exist. Use EXACTLY these tool names and operations, nothing else:';

/** The end of that prompt. */
export const UNKNOWN_TOOL_PROMPT_TAIL =
  'Put the tool name in toolName and the operation in operation. Check the workspace state, then continue the task.';
