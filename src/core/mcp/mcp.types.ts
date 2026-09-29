/** Where a server was declared. A workspace file is untrusted content. */
export type McpServerOrigin = 'user' | 'workspace';

/** Mirrors `mcpOAuthSchema`; declared here so the types do not import the schemas. */
export interface McpOAuthConfig {
  readonly clientId: string;
  readonly authorizationEndpoint?: string | undefined;
  readonly tokenEndpoint?: string | undefined;
  readonly scopes: readonly string[];
  readonly resource?: string | undefined;
}

interface McpServerBase {
  readonly name: string;
  readonly origin: McpServerOrigin;
}

export interface McpStdioServerConfig extends McpServerBase {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface McpHttpServerConfig extends McpServerBase {
  readonly transport: 'http';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly oauth?: McpOAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpConfigLoad {
  readonly servers: readonly McpServerConfig[];
  readonly errors: readonly string[];
}

/** Which policy refused a server, so the report names who to ask. */
export type McpPolicySource = 'organization' | 'project';

export type McpRefusalCode =
  'MCP_SERVER_DENIED' | 'MCP_SERVER_NOT_ALLOWED' | 'MCP_WORKSPACE_UNTRUSTED';

export interface McpServerRefusal {
  readonly name: string;
  readonly code: McpRefusalCode;
  readonly source?: McpPolicySource;
  readonly reason: string;
}

export interface McpAdmission {
  readonly admitted: readonly McpServerConfig[];
  readonly refused: readonly McpServerRefusal[];
}

/** One tool as the model sees it: bounded, and marked as untrusted text. */
export interface McpToolSummary {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: string;
}

export interface McpContentSummary {
  readonly text: string;
  readonly truncated: boolean;
  readonly isError: boolean;
  readonly omittedParts: readonly string[];
}

/** A connected server, whatever its transport. */
export interface McpTransport {
  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  /** HTTP echoes the negotiated revision on later requests; stdio has nowhere to put it. */
  setProtocolVersion?(version: string): void;
  dispose(): void;
}

export interface McpTokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  /** Epoch milliseconds; absent when the server did not say. */
  readonly expiresAt?: number | undefined;
}

export interface McpAuthorizationEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
}

/** An initialized MCP session, as the registry uses it; `McpClient` implements it. */
export interface McpSession {
  listTools(signal?: AbortSignal): Promise<McpToolSummary[]>;
  callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<McpContentSummary>;
  dispose(): void;
}
