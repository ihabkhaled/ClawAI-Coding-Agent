import type { AgentContextConfig } from './agent-context.types';
import type { AgentBudgetProfile, AgentMemoryMode, RuntimeTransportPort } from './agent-sdk.types';
import type { TeamLink } from './agent-team-tool.types';
import type { AgentBrowserOptions } from './browser-tool.types';
import type { DoneCheck, DoneCheckSummary } from './done-checks.types';
import type { AgentMcpOptions } from './mcp-toolkit.types';
import type { AgentPermissionMode } from './permission-modes.types';
import type { StuckInfo } from './repetition-guard.types';
import type { RunBudgetKind } from './run-budget.types';
import type { PlanStepInput } from './task-plan-tool.types';
import type { AgentVisionOptions } from './vision-tool.types';
import type { AgentPermissions } from './workspace-toolkit.types';
import type { EffortMode } from '../core/effort-mode';
import type { HeadlessExitCode, HeadlessOutcome } from '../core/headless-outcome.types';
import type { ResearchMode } from '../core/research-mode';
import type { SpeedMode } from '../core/speed-mode';
import type { WebResearchPort } from '../core/web-research.types';
import type { RetryTuning } from '../headless/retry-policy.types';

/** A token already issued, or credentials to exchange for one. */
export type AgentAuth =
  { readonly token: string } | { readonly email: string; readonly password: string };

export interface AgentConfig {
  readonly auth: AgentAuth;
  /** Every file, command and git call is contained in this directory. */
  readonly workspaceRoot: string;
  /** Defaults to the local gateway when omitted. */
  readonly backendUrl?: string | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  /** Defaults to read and git only; writing and commands are opt-in. */
  readonly permissions?: AgentPermissions | undefined;
  readonly deadlineMs?: number | undefined;
  /** Continues this existing thread; `agent.threadId` is set once a run has started. */
  readonly threadId?: string | undefined;
  /**
   * Operator instructions, up to 20,000 characters. They travel as a framed block
   * ahead of the task and add to the runtime's own instructions; they never
   * appear in events or error text.
   */
  readonly systemPrompt?: string | undefined;
  /** MCP servers offered as `runtime.mcp`; needs the `mcp` grant, added by default. */
  readonly mcp?: AgentMcpOptions | undefined;
  /** `plan`, `ask` or `accept-edits`, applied over `permissions` and its `approve` callback. */
  readonly permissionMode?: AgentPermissionMode | undefined;
  /** Glob lists over tool identifiers, see `AgentToolFilter`. Deny wins. */
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
  /**
   * A new thread ignores the account's stored personal memories unless this is
   * true, so a repository task is deterministic. A continued `threadId` is never
   * changed. Best effort: a backend that refuses the setting is reported as a
   * `thread.memory-unchanged` event and the run continues.
   */
  readonly useMemory?: boolean | undefined;
  /**
   * Images attached to the FIRST prompt: file paths (relative ones from `workspaceRoot`), png, jpeg
   * or webp, up to 8 MB each, at most 4. Read and checked when the agent is created.
   */
  readonly images?: readonly string[] | undefined;
  /** Offers `vision.describe` so any model can look at a screenshot; see `AgentVisionOptions`. */
  readonly vision?: AgentVisionOptions | undefined;
  /** Substituted in tests, and by a caller speaking to a different backend. */
  readonly transport?: RuntimeTransportPort | undefined;
  /** Tunes how runtime calls are retried when the runtime is briefly away; see `RETRY_DEFAULTS`. */
  readonly retry?: RetryTuning | undefined;
  /**
   * What "done" means, defined by the orchestrator and enforced here. When a run
   * ends `completed`, every check runs (sequentially, all of them); a failure
   * makes the run unfinished and `autoContinue` tells the model what failed.
   * Checks bypass the allowlist, write scope and permission mode, because the
   * caller wrote them. See `DoneCheck`.
   */
  readonly doneChecks?: readonly DoneCheck[] | undefined;
  /**
   * Steps the orchestrator imposes on the run (--plan-file): loaded into the task plan before the
   * model starts and locked, so the model can mark them done (a step with a check only when the check
   * passes) but cannot drop or weaken them. Applies to a new conversation, or to a resumed one with no plan.
   */
  readonly planSteps?: readonly PlanStepInput[] | undefined;
  /** Refuse to complete without a plan: a run that ends with none is continued, then fails PLAN_INCOMPLETE. */
  readonly requirePlan?: boolean | undefined;
  /**
   * Offers `task.plan`, the step plan a model keeps for itself. Off unless asked for, so the
   * default tool list does not grow; it is also offered when `planSteps` or `requirePlan` is set.
   */
  readonly taskPlan?: boolean | undefined;
  /**
   * How hard the run may work: the editor's Effort control, LOW to ULTRA. It picks
   * the run budget (model turns, tool calls, rounds, repair, wall clock, output and
   * result bytes) through the same table the editor uses, and takes the place of the
   * long profile; maxTurns on a call still narrows it.
   */
  readonly effort?: EffortMode | undefined;
  /**
   * The editor's Speed control. It sets how many workspace lookups run at once while
   * context is collected, and does nothing else: it never changes which files are read.
   */
  readonly speed?: SpeedMode | undefined;
  /** Which context the run starts with; see AgentContextConfig. Absent means none. */
  readonly context?: AgentContextConfig | undefined;
  /**
   * The editor's Web research control. It decides which web tools the agent is
   * offered (search, fetch, crawl, extract); the runtime run request carries no
   * research field, so it is not sent to the server. Absent means none.
   */
  readonly research?: ResearchMode | undefined;
  /** Limits and allowed hosts for `browser.page`; the tool needs the `browser` grant. */
  readonly browser?: AgentBrowserOptions | undefined;
  /**
   * Reads the repository like an engineer: a compact summary of the root instruction
   * files goes in front of a NEW thread's first task, and `knowledge.context` is offered
   * (index, read, search, task) wherever `read` is granted. The files are untrusted
   * advice: nothing in them can add a tool, an approval or write access.
   */
  readonly loadKnowledge?: boolean | undefined;
  /**
   * A routine's secrets (ADR-143): environment variables of the `workspace.command`
   * child processes only. They are never sent to the model, never put in the
   * prompt, and any occurrence in a command's output is replaced by [REDACTED].
   */
  readonly secretEnvironment?: Readonly<Record<string, string>> | undefined;
  /** Replaces the research service calls, for tests and for hosts with their own. */
  readonly webResearch?: WebResearchPort | undefined;
  /** With the `agents` grant: how many sub-agents work at once, 1 to 8 (default 4). */
  readonly maxAgents?: number | undefined;
  /** Set by a parent that starts this agent as a child; not for callers. */
  readonly teamLink?: TeamLink | undefined;
}

export interface AgentRunCallOptions {
  readonly onEvent?: ((event: AgentEvent) => void) | undefined;
  /** Aborting ends the run as `cancelled` (exit 130). */
  readonly signal?: AbortSignal | undefined;
  /** The runtime's model-turn budget for this run. */
  readonly maxTurns?: number | undefined;
  /**
   * Stops the run as `exhausted` (exit 5) when the model asks for more tool
   * calls than this. The call past the limit is refused and never runs.
   */
  readonly maxToolCalls?: number | undefined;
  /** Stops the run as `exhausted` (exit 5) after this many milliseconds, cancelling a call in flight. */
  readonly maxDurationMs?: number | undefined;
  readonly title?: string | undefined;
  /** The server-side allowance requested for the run; see `AGENT_BUDGET_PROFILES`. Defaults to `default`. */
  readonly budgetProfile?: AgentBudgetProfile | undefined;
  /**
   * How many times to start a new run on the same thread when a run ends because
   * the SERVER budget was used up (0 to 20, default 0). `maxToolCalls` and
   * `maxDurationMs` are totals across all the runs; when they have no room left
   * the work stops as `exhausted` instead.
   */
  readonly autoContinue?: number | undefined;
}

/** What a run reports while it happens, in the order it happens. */
export type AgentEvent =
  | {
      readonly type: 'run.started';
      readonly runId: string;
      readonly threadId: string;
      /** Absent for a continued thread, whose settings were not touched or read. */
      readonly memory?: AgentMemoryMode;
    }
  | {
      readonly type: 'thread.memory-unchanged';
      /** The HTTP status the backend answered the memory setting with. */
      readonly status: number;
    }
  | {
      readonly type: 'images.not-delivered';
      /** Images uploaded and named in the run request. */
      readonly sent: number;
      /** Images the backend kept on the prompt message. */
      readonly delivered: number;
    }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool.call';
      readonly toolName: string;
      readonly operation: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'tool.denied'; readonly toolName: string; readonly operation: string }
  | {
      readonly type: 'tool.result';
      readonly toolName: string;
      readonly operation: string;
      readonly ok: boolean;
      readonly message?: string;
    }
  | {
      readonly type: 'runtime';
      readonly name: string;
      readonly payload?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: 'budget.exhausted';
      readonly budget: RunBudgetKind;
      /** A call count for `tool-calls`, milliseconds for `duration`. */
      readonly limit: number;
    }
  | {
      readonly type: 'run.continued';
      /** 1 for the first continuation. */
      readonly attempt: number;
      readonly reason:
        | 'budget-exhausted'
        | 'run-lost'
        | 'stuck'
        | 'checks-failed'
        | 'plan-incomplete'
        | 'session-expired'
        | 'unknown-tool';
    }
  | {
      readonly type: 'run.checks';
      /** True when every completion check exited 0. */
      readonly passed: boolean;
      /** `exitCode` is -1 for a check that did not exit. A failing check carries `tail`. */
      readonly checks: readonly {
        readonly label: string;
        readonly ok: boolean;
        readonly exitCode: number;
        readonly durationMs: number;
        /** The last 600 characters of a failing check's output, redacted. */
        readonly tail?: string;
      }[];
    }
  | {
      readonly type: 'run.plan';
      /** Step counts of the task plan, after every change the model (or the orchestrator's preload) made to it. */
      readonly total: number;
      readonly todo: number;
      readonly doing: number;
      readonly done: number;
      readonly blocked: number;
    }
  | {
      readonly type: 'run.stuck';
      /** The call the run kept repeating, made this many times with nothing changed. */
      readonly tool: string;
      readonly operation: string;
      readonly times: number;
    }
  | {
      readonly type: 'run.retrying';
      /** 1 for the first retry of one call. */
      readonly attempt: number;
      /** How long the call waits before trying again. */
      readonly waitMs: number;
      /** The HTTP status that caused it, when there was one. */
      readonly status?: number;
      /** A network error code, when there was no HTTP status. */
      readonly code?: string;
    }
  | {
      readonly type: 'note.added';
      readonly id: number;
      readonly tag?: string;
      /** The note's length; its text is never in an event. */
      readonly chars: number;
    }
  | {
      readonly type: 'write-scope.violation';
      /** The tool that was refused, or whose command changed a path outside the write scope. */
      readonly tool: string;
      /** Workspace-relative, forward-slash. Refused or, for a command, reverted. */
      readonly paths: readonly string[];
    }
  | {
      readonly type: 'context.collected';
      readonly mode: string;
      readonly included: number;
      readonly excluded: number;
      readonly truncated: boolean;
    }
  | {
      readonly type: 'agent.spawned';
      readonly name: string;
      /** The agent that started it: `lead` or another child. */
      readonly parent: string;
      /** 1 for a child of the lead. */
      readonly depth: number;
      /** The start of the brief, redacted. */
      readonly task: string;
      readonly tools: readonly string[];
      readonly writeScope?: readonly string[];
      readonly isolation: 'none' | 'worktree';
      readonly maxToolCalls: number;
      readonly maxDurationSec: number;
      readonly model?: string;
    }
  | {
      readonly type: 'agent.message';
      /** Stamped by the bus: the sender cannot choose it. */
      readonly from: string;
      readonly to: string;
      /** The text's length; the text is never in an event. */
      readonly chars: number;
    }
  | {
      readonly type: 'agent.finished';
      readonly name: string;
      readonly parent: string;
      readonly state: 'completed' | 'failed' | 'cancelled';
      readonly outcome?: HeadlessOutcome;
      readonly toolCalls: number;
      readonly durationMs: number;
      /** Files the child changed, by its own write calls. */
      readonly files: number;
      /** The child's conversation, for finding its run afterwards. */
      readonly threadId?: string;
      readonly error?: string;
    }
  | { readonly type: 'run.finished'; readonly result: AgentResult };

export interface AgentResult {
  readonly outcome: HeadlessOutcome;
  readonly exitCode: HeadlessExitCode;
  readonly toolCalls: number;
  readonly deniedCalls: number;
  /** The model's streamed answer, concatenated. */
  readonly text: string;
  readonly runId?: string;
  /** The thread the run used; pass it as `threadId` to continue the conversation. */
  readonly threadId?: string;
  readonly terminalEvent?: string;
  /** True when the last run ended because the runtime's budget for it was used up. */
  readonly budgetExhausted?: true;
  /** True when the runtime no longer knew the last run (a restart, an expired claim). */
  readonly runLost?: true;
  /** True when the runtime ended the run because the model named a tool that was not offered. */
  readonly unknownTool?: true;
  /** True when the access token expired mid-run; with an email and password a continuation signs in again. */
  readonly sessionExpired?: true;
  /**
   * Set when the run was ended for repeating one call with nothing changing: the
   * outcome is `failed` (exit 1) and `error` starts with `STUCK`. `autoContinue`
   * treats it like a used-up budget.
   */
  readonly stuck?: StuckInfo;
  /** How many follow-up runs `autoContinue` started; the totals above cover all of them. */
  readonly continuations?: number;
  /** Why the run could not proceed, when it threw rather than ended. Never a secret. */
  readonly error?: string;
  /** `DONE_CHECKS_FAILED`: the run completed but the orchestrator's checks still fail. The outcome is `failed`. */
  readonly errorCode?: 'DONE_CHECKS_FAILED' | 'PLAN_INCOMPLETE';
  /** The last completion checks that ran; absent when none were configured or the run never completed. */
  readonly checks?: readonly DoneCheckSummary[];
}

export interface Agent {
  /** The conversation this agent continues: the one given, else the first run's. */
  readonly threadId?: string | undefined;
  run(prompt: string, options?: AgentRunCallOptions): Promise<AgentResult>;
}
