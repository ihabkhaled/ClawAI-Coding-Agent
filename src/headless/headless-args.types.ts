import type { HeadlessLogin } from './mcp/mcp-login.types';
import type { AgentPermissionMode } from '../sdk/permission-modes.types';
import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

export type HeadlessOutputFormat = 'text' | 'json' | 'stream-json';

/** Everything an invocation decided, before any network call. */
export interface HeadlessInvocation {
  readonly prompt: string;
  readonly workspace: string;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly backendUrl?: string | undefined;
  readonly allowTools: readonly AgentToolCategory[];
  readonly allowCommands: readonly string[];
  readonly outputFormat: HeadlessOutputFormat;
  readonly maxTurns?: number | undefined;
  /** Stops the run as `exhausted` (exit 5) once exceeded. */
  readonly maxToolCalls?: number | undefined;
  readonly maxDurationMs?: number | undefined;
  /** Token file for OAuth MCP servers; a run reads it and keeps refreshed tokens in memory. */
  readonly mcpTokenFile?: string | undefined;
  /** Thread to continue: from `--resume`, or resolved from the store for `--continue`. */
  readonly resume?: string | undefined;
  readonly continueLast?: true | undefined;
  /** Text, or `@path`; read by the runner, not the parser. */
  readonly appendSystemPrompt?: string | undefined;
  readonly systemPromptFile?: string | undefined;
  readonly mcpConfig?: string | undefined;
  readonly permissionMode?: AgentPermissionMode | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
}

/** A parse either yields a run, asks for help, or names the mistake. */
export type HeadlessParse =
  | { readonly kind: 'run'; readonly invocation: HeadlessInvocation }
  | { readonly kind: 'login'; readonly login: HeadlessLogin }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage'; readonly message: string };

/** The process environment, as far as the runner reads it. */
export type HeadlessEnvironment = Readonly<Record<string, string | undefined>>;

/** Where the runner writes; injected so output is testable without a process. */
export interface HeadlessIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /**
   * Asks a person a yes/no question. Absent when nobody can answer, in which
   * case anything that needs approval is denied rather than assumed.
   */
  readonly confirm?: ((question: string) => Promise<boolean>) | undefined;
}
