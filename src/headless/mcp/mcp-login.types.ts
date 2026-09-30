import type { McpFetch } from '../../infrastructure/mcp/mcp-transport.types';

/** The few file operations the token store needs, so a test can watch the mode it asks for. */
export interface McpTokenFileFs {
  readonly readFile: (file: string) => Promise<string | undefined>;
  readonly writeFile: (file: string, text: string, mode: number) => Promise<void>;
  readonly rename: (from: string, to: string) => Promise<void>;
  readonly mkdir: (directory: string, mode: number) => Promise<void>;
}

/** What `--mcp-login` was asked to do. */
export interface HeadlessLogin {
  readonly server: string;
  readonly mcpConfig: string;
  readonly tokenFile?: string | undefined;
}

/** Everything the login flow reaches for, injectable. */
export interface McpLoginContext {
  readonly cwd: string;
  readonly signal?: AbortSignal | undefined;
  /** Present only when a terminal is attached; it opens the URL in a browser. */
  readonly openUrl?: ((url: string) => void) | undefined;
  readonly fetch?: McpFetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly home?: string | undefined;
}
