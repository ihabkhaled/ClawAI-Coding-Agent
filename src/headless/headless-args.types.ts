import type { HeadlessLogin } from './mcp/mcp-login.types';
import type { EffortMode } from '../core/effort-mode';
import type { ResearchMode } from '../core/research-mode';
import type { SpeedMode } from '../core/speed-mode';
import type { AgentContextConfig } from '../sdk/agent-context.types';
import type { AgentBudgetProfile } from '../sdk/agent-sdk.types';
import type { GateName } from '../sdk/code-gates.types';
import type { DoneCheck } from '../sdk/done-checks.types';
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
  /** `--allow-shell`: the second switch for workspace.shell; `shell` is then in `allowTools`. */
  readonly allowShell?: true | undefined;
  /** `--shell-deny`: extra refusal patterns for shell scripts. */
  readonly shellDeny?: readonly string[] | undefined;
  readonly outputFormat: HeadlessOutputFormat;
  readonly maxTurns?: number | undefined;
  /** Stops the run as `exhausted` (exit 5) once exceeded. */
  readonly maxToolCalls?: number | undefined;
  readonly maxDurationMs?: number | undefined;
  /** The server budget requested for each run; the CLI defaults to `long`. */
  readonly budgetProfile?: AgentBudgetProfile | undefined;
  /** Follow-up runs allowed when the server budget ends one (0 to 20, default 3). */
  readonly autoContinue?: number | undefined;
  /** Token file for OAuth MCP servers; a run reads it and keeps refreshed tokens in memory. */
  readonly mcpTokenFile?: string | undefined;
  /** Thread to continue: from `--resume`, or resolved from the store for `--continue`. */
  readonly resume?: string | undefined;
  readonly continueLast?: true | undefined;
  /** Text, or `@path`; read by the runner, not the parser. */
  readonly appendSystemPrompt?: string | undefined;
  readonly systemPromptFile?: string | undefined;
  readonly mcpConfig?: string | undefined;
  /** `--use-memory`: keep the account's personal memories on a new thread. Absent means off. */
  readonly useMemory?: true | undefined;
  readonly permissionMode?: AgentPermissionMode | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
  /** Globs every file and git change must match; see `docs/HEADLESS.md`, Write scope. */
  readonly writeScope?: readonly string[] | undefined;
  readonly writeDeny?: readonly string[] | undefined;
  /** Hosts `http.request` may reach, from `--http-allow-host`. */
  readonly httpAllowHosts?: readonly string[] | undefined;
  /** Completion checks from `--done-check`; the file form is read by the runner. */
  readonly doneChecks?: readonly DoneCheck[] | undefined;
  /** `--done-check-file`, resolved against the working directory; read by the runner. */
  readonly doneCheckFile?: string | undefined;
  /** `--plan-file`, resolved against the working directory; read by the runner. */
  readonly planFile?: string | undefined;
  /** `--require-plan`: a run may not complete without a plan, or with an open step. */
  readonly requirePlan?: true | undefined;
  /** `--task-plan`: offer the `task.plan` tool without requiring a plan. */
  readonly taskPlan?: true | undefined;
  /** `--done-check-gates`: gates to expand into done checks, from the project's own commands. */
  readonly doneCheckGates?: readonly GateName[] | undefined;
  /** `--effort`: the run budget from the editor's Effort table. Replaces `--budget`. */
  readonly effort?: EffortMode | undefined;
  /** `--speed`: parallel workspace lookups while context is collected. */
  readonly speed?: SpeedMode | undefined;
  /** `--context-mode` with `--context-file` and `--context-selection`. */
  readonly context?: AgentContextConfig | undefined;
  /** `--research`: which web tools the agent is offered. */
  readonly research?: ResearchMode | undefined;
  /** `--browser-allow-host`: private or local hosts the browser tool may open. */
  readonly browserAllowHosts?: readonly string[] | undefined;
  /** `--load-knowledge`: summarize the root instruction files into the prompt and offer `knowledge.context`. */
  readonly loadKnowledge?: true | undefined;
  /** `--image`: absolute paths attached to the first prompt. */
  readonly images?: readonly string[] | undefined;
  /** `--vision-model`: the model that answers `vision.describe`. */
  readonly visionModel?: string | undefined;
  /** `--vision`, `--image` or `--vision-model`: `vision.describe` is offered. */
  readonly vision?: true | undefined;
  /** `--max-agents`: sub-agents working at once, 1 to 8. */
  readonly maxAgents?: number | undefined;
}

/** `--list-models`: print the account's models and exit. */
export interface HeadlessListModels {
  readonly backendUrl?: string | undefined;
  readonly json: boolean;
}

/** A parse either yields a run, asks for help, or names the mistake. */
export type HeadlessParse =
  | { readonly kind: 'run'; readonly invocation: HeadlessInvocation }
  | { readonly kind: 'login'; readonly login: HeadlessLogin }
  | { readonly kind: 'list-models'; readonly request: HeadlessListModels }
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
