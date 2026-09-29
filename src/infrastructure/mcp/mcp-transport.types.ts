export interface McpStdioLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string | undefined;
}

/**
 * Supplies and renews the bearer token for one HTTP server. `renew` is called
 * once after a 401: it refreshes, or runs the authorization flow, or answers
 * `undefined` when the server has no OAuth configuration.
 */
export interface McpTokenProvider {
  current(signal?: AbortSignal): Promise<string | undefined>;
  renew(signal?: AbortSignal): Promise<string | undefined>;
}

export type McpFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface McpHttpEndpoint {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}
