/** The runtime tool the agent reaches every MCP server through. */
export const MCP_TOOL_NAME = 'runtime.mcp';

/** The MCP revision this client speaks. A server may answer with an older one. */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** Revisions this client can talk to; a server answering anything else is closed. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const MCP_CLIENT_NAME = 'clawai-coding-agent';

/** Where a workspace declares its servers, relative to the workspace root. */
export const MCP_WORKSPACE_CONFIG_SEGMENTS = ['.clawai', 'mcp.json'] as const;

export const MAX_MCP_CONFIG_BYTES = 128_000;
export const MAX_MCP_SERVERS = 32;
export const MAX_MCP_SERVER_NAME_LENGTH = 64;

/** Handshake, listing and call ceilings. A server that is slower is treated as gone. */
export const MCP_INITIALIZE_TIMEOUT_MS = 20_000;
export const MCP_LIST_TIMEOUT_MS = 20_000;
export const MCP_CALL_TIMEOUT_MS = 120_000;
export const MCP_MAX_CALL_TIMEOUT_MS = 600_000;

/** How many `tools/list` pages are followed before the listing is cut. */
export const MCP_MAX_TOOL_PAGES = 10;
export const MCP_MAX_TOOLS_PER_SERVER = 500;

/** A single framed message larger than this ends the connection. */
export const MCP_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
/** How much of a server's stderr is kept for diagnostics. */
export const MCP_STDERR_TAIL_BYTES = 4_096;

/** Bounds on what a tool result may put in front of the model. */
export const MCP_MAX_RESULT_TEXT_CHARACTERS = 48_000;
export const MCP_MAX_DESCRIPTION_CHARACTERS = 1_000;
export const MCP_MAX_SCHEMA_CHARACTERS = 4_000;
export const MCP_TRUNCATION_NOTICE = '\n[truncated by ClawAI: the MCP result exceeded its bound]';

/** How long a stdio server is given to exit after its stdin closes. */
export const MCP_STDIO_EXIT_GRACE_MS = 2_000;

/** OAuth bounds. */
export const MCP_OAUTH_TIMEOUT_MS = 5 * 60 * 1_000;
export const MCP_OAUTH_SECRET_PREFIX = 'clawai.mcp.oauth.';
export const MCP_OAUTH_EXPIRY_MARGIN_MS = 60_000;
export const MCP_OAUTH_METADATA_PATH = '/.well-known/oauth-authorization-server';

/** Hosts an `http:` MCP URL may name. Everything else must be `https:`. */
export const MCP_LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

/** JSON-RPC error codes this client answers server-initiated requests with. */
export const JSON_RPC_METHOD_NOT_FOUND = -32_601;
