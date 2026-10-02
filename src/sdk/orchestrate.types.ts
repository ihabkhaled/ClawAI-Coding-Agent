import type { AgentFactory } from './agent-team-tool.types';
import type { AgentConfig } from './create-agent.types';
import type { DoneCheck } from './done-checks.types';
import type { orchestratePlanSchema } from './orchestrate-plan.schema';
import type { AgentToolCategory } from './workspace-toolkit.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';
import type { z } from 'zod';

/** A plan after the schema has filled its defaults. */
export type OrchestratePlan = z.output<typeof orchestratePlanSchema>;
export type OrchestrateStage = OrchestratePlan['stages'][number];
export type OrchestrateAgent = OrchestrateStage['agents'][number];

/** What `onFailure` means once parsed. */
export interface FailurePolicy {
  readonly mode: 'stop' | 'continue' | 'retry';
  /** Extra attempts an agent gets after a failure (0 unless `retry`). */
  readonly retries: number;
}

/** What a plan may ask for, set by whoever runs it: the plan can only narrow this. */
export interface OrchestrateCeiling {
  readonly allow: readonly AgentToolCategory[];
  /** Whether the shell's second switch is on. */
  readonly shell: boolean;
  readonly httpAllowHosts: readonly string[];
  readonly browserAllowHosts: readonly string[];
}

/** A plan that passed every check, with what the checks worked out. */
export interface ValidatedPlan {
  readonly plan: OrchestratePlan;
  readonly policy: FailurePolicy;
  /** Stage ids in an order that respects every dependency. */
  readonly order: readonly string[];
  /** The same stages in waves: everything in a wave can start once the earlier waves are done. */
  readonly waves: readonly (readonly string[])[];
  /** Pairs of agents that may run at the same time (same wave or unordered stages), as "stage/agent". */
  readonly parallelPairs: readonly (readonly [string, string])[];
  /** Things that are allowed but probably not meant. */
  readonly warnings: readonly string[];
}

export type PlanCheck =
  | { readonly ok: true; readonly value: ValidatedPlan }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The result of one check, with the end of its output. */
export interface CheckResult {
  readonly label: string;
  readonly ok: boolean;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly tail: string;
}

export type AgentState = 'completed' | 'failed' | 'cancelled' | 'skipped';
export type StageStatus = 'passed' | 'failed' | 'skipped' | 'cancelled';
export type RunStatus = 'passed' | 'failed' | 'cancelled' | 'timeout';

/** What one attempt of an agent produced. */
export interface AgentAttempt {
  readonly state: 'completed' | 'failed' | 'cancelled';
  readonly outcome?: HeadlessOutcome | undefined;
  readonly error?: string | undefined;
  /** The agent's own final report, redacted and cut. */
  readonly summary: string;
  readonly toolCalls: number;
  readonly durationMs: number;
  readonly files: readonly string[];
  readonly checks: readonly CheckResult[];
  readonly mergeProblem?: string | undefined;
  readonly threadId?: string | undefined;
}

export interface AgentReport {
  readonly name: string;
  readonly stage: string;
  readonly state: AgentState;
  readonly attempts: number;
  readonly model?: string | undefined;
  readonly reason?: string | undefined;
  readonly result?: AgentAttempt | undefined;
}

export interface StageReport {
  readonly id: string;
  readonly status: StageStatus;
  readonly reason?: string | undefined;
  readonly durationMs: number;
  readonly agents: readonly AgentReport[];
  readonly gate?: { readonly passed: boolean; readonly checks: readonly CheckResult[] } | undefined;
}

export interface OrchestrateReport {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly plan: { readonly name: string; readonly goal: string; readonly workspace: string };
  readonly status: RunStatus;
  readonly reason?: string | undefined;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly totals: { readonly agents: number; readonly toolCalls: number; readonly files: number };
  readonly waves: readonly (readonly string[])[];
  readonly stages: readonly StageReport[];
  /** Where report.json and report.md were written, when they were. */
  readonly directory?: string | undefined;
}

/** What the orchestrator streams while it works. Every event has a `type` starting `orchestrate.`. */
export type OrchestrateEvent =
  | {
      readonly type: 'orchestrate.started';
      readonly runId: string;
      readonly plan: string;
      readonly stages: number;
      readonly agents: number;
      readonly maxParallel: number;
    }
  | { readonly type: 'orchestrate.stage.started'; readonly stage: string; readonly agents: number }
  | {
      readonly type: 'orchestrate.stage.finished';
      readonly stage: string;
      readonly status: StageStatus;
      readonly durationMs: number;
      readonly reason?: string;
    }
  | {
      readonly type: 'orchestrate.agent.started';
      readonly stage: string;
      readonly name: string;
      readonly attempt: number;
      readonly model?: string;
    }
  | {
      readonly type: 'orchestrate.agent.retrying';
      readonly stage: string;
      readonly name: string;
      readonly attempt: number;
      readonly error?: string;
    }
  | {
      readonly type: 'orchestrate.agent.finished';
      readonly stage: string;
      readonly name: string;
      readonly state: AgentState;
      readonly attempts: number;
      readonly toolCalls: number;
      readonly durationMs: number;
      readonly files: number;
      readonly error?: string;
    }
  | {
      readonly type: 'orchestrate.gate';
      readonly stage: string;
      readonly passed: boolean;
      readonly checks: readonly {
        readonly label: string;
        readonly ok: boolean;
        readonly exitCode: number;
      }[];
    }
  | {
      readonly type: 'orchestrate.finished';
      readonly runId: string;
      readonly status: RunStatus;
      readonly durationMs: number;
      readonly reason?: string;
    };

/** One attempt the engine asks a runner to make. */
export interface AgentJob {
  readonly stage: string;
  readonly agent: OrchestrateAgent;
  readonly attempt: number;
  /** The model for this attempt: the agent's own, or the pool's pick. Undefined means the run model. */
  readonly model: string | undefined;
  readonly signal: AbortSignal;
}

/** Makes one attempt and says how it went; it must settle soon after the signal aborts, and never reject. */
export type AgentRunner = (job: AgentJob) => Promise<AgentAttempt>;

/** Runs a stage gate's checks (all of them) and returns their results. */
export type GateRunner = (
  checks: readonly DoneCheck[],
  signal: AbortSignal,
) => Promise<readonly CheckResult[]>;

/** What `orchestrate()` is given besides the plan. */
export interface OrchestrateOptions {
  /** Credentials, backend, model, transport and the operator's permissions every agent is narrowed from. */
  readonly config: Omit<AgentConfig, 'workspaceRoot'>;
  /** What the plan may ask for; default: local work only (read, write, command, git, git-write). */
  readonly ceiling?: Partial<OrchestrateCeiling> | undefined;
  readonly onEvent?: ((event: OrchestrateEvent) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
  /** Where `orchestrate/<run>/report.*` goes; default: the headless state directory. */
  readonly stateDirectory?: string | undefined;
  /** Replaces `createAgent`, for tests. */
  readonly factory?: AgentFactory | undefined;
  /** Resolves the plan's relative workspace; default: the process directory. */
  readonly cwd?: string | undefined;
}
