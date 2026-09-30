/** The per-user directory name under the platform's config root. */
export const MCP_LOGIN_CONFIG_DIR_NAME = 'clawai';

/** The token file inside that directory; `--mcp-token-file` replaces the whole path. */
export const MCP_LOGIN_TOKEN_FILE_NAME = 'mcp-tokens.json';

/** Owner read/write only. Windows ignores the bits; the per-user directory carries the ACL. */
export const MCP_TOKEN_FILE_MODE = 0o600;
export const MCP_TOKEN_DIR_MODE = 0o700;

/** A token file larger than this is treated as unreadable rather than parsed. */
export const MCP_TOKEN_FILE_MAX_BYTES = 1_048_576;
export const MCP_TOKEN_FILE_VERSION = 1;

export const MCP_LOGIN_CALLBACK_PATH = '/auth/callback';
export const MCP_LOGIN_LOOPBACK_HOST = '127.0.0.1';

/** Said by a run that reaches a server with no stored token. */
export const MCP_LOGIN_REQUIRED_MESSAGE =
  'The MCP server needs a sign-in. Run clawai --mcp-login <server> --mcp-config <file> first.';
