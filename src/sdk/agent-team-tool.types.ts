import type { AgentToolkit } from './agent-sdk.types';
import type { Agent, AgentConfig, AgentEvent } from './create-agent.types';
import type { DoneCheck } from './done-checks.types';
import type { AgentToolCategory } from './workspace-toolkit.types';
import type { HeadlessOutcome } from '../core/headless-outcome.types';

/** The operations of the `agent.team` tool. */
export type TeamOperation = 'spawn' | 'message' | 'inbox' | 'wait' | 'status' | 'result' | 'cancel';

/** Where a child stands: waiting for a slot, working, or over (and how). */
export type TeamChildState = 'queued' | 'running' | TeamFinalState;

/** How a child that is over ended. */
export type TeamFinalState = 'completed' | 'failed' | 'cancelled';

/** What a spawn asks for, validated. */
export interface SpawnRequest {
  readonly name: string;
  readonly task: string;
  readonly model: string | undefined;
  readonly tools: readonly AgentToolCategory[] | undefined;
  readonly writeScope: readonly string[] | undefined;
  readonly maxToolCalls: number | undefined;
  readonly maxDurationSec: number | undefined;
  readonly workspaceSubdir: string | undefined;
  readonly isolation: 'none' | 'worktree';
  /** Hosts `http.request` may reach, each inside the parent's own list; none means the child has no http. */
  readonly httpAllowHosts?: readonly string[] | undefined;
  /** Private hosts `browser.page` may open, each listed by the parent; public hosts need no entry. */
  readonly browserAllowHosts?: readonly string[] | undefined;
  /** Gives the child `workspace.shell`: only when the parent holds it, and every script still goes to the parent's approver. */
  readonly shell?: boolean | undefined;
  /** Completion checks the child must pass; written by the starter, never by the child. */
  readonly doneChecks?: readonly DoneCheck[] | undefined;
}

/** A message in flight; `from` is stamped by the bus owner, never taken from the sender's text. */
export interface TeamMessage {
  readonly id: number;
  readonly from: string;
  readonly to: string;
  readonly text: string;
}

/** The per-agent mailboxes of one run. */
export interface TeamBus {
  /** Throws a message the sender can read when the recipient is unknown, finished or full. */
  post(from: string, to: string, text: string): TeamMessage;
  register(name: string): void;
  /** After this the name receives nothing and a post to it is refused. */
  close(name: string): void;
  /** Takes the unread messages of `name`, oldest first, at most `limit` characters of text. */
  drain(name: string, limit: number): readonly TeamMessage[];
  pending(name: string): number;
  /** Called with the recipient's name after each post. */
  onPost(listener: (to: string) => void): () => void;
}

/** Where a worktree-isolated child works, and what it left. */
export interface TeamWorktree {
  /** The repository's top directory, where the patch is applied. */
  readonly repo: string;
  /** The worktree's top directory. */
  readonly directory: string;
  /** The workspace as the child sees it: the worktree plus the workspace's prefix inside the repository. */
  readonly workspace: string;
  /** The prefix of the workspace inside the repository, forward-slash, empty at the top. */
  readonly prefix: string;
}

/** What taking a child's changes back into the workspace did. */
export interface TeamMergeReport {
  readonly merged: boolean;
  readonly files: readonly string[];
  readonly patchFile?: string;
  readonly problem?: string;
}

/** One child, as the team keeps it. */
export interface TeamChild {
  readonly name: string;
  readonly parent: string;
  readonly depth: number;
  readonly task: string;
  readonly abort: AbortController;
  readonly touched: Set<string>;
  readonly granted: readonly AgentToolCategory[];
  /** What the child may change as its siblings must read it: `[]` when it cannot, or works in a worktree. */
  readonly writeGlobs: readonly string[];
  readonly isolated: boolean;
  /** Whether a workspace-relative path is one the child may change. */
  readonly mayChange: (path: string) => boolean;
  /** Tool calls set aside from the parent's allowance while the child runs. */
  readonly reserved: number;
  readonly maxDurationMs: number | undefined;
  state: TeamChildState;
  outcome: HeadlessOutcome | undefined;
  error: string | undefined;
  report: string;
  toolCalls: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  /** The child's conversation, known once its run has started. */
  threadId: string | undefined;
  worktree: TeamWorktree | undefined;
  merge: TeamMergeReport | undefined;
  /** Settles when the child is over, whatever way it ended; it never rejects. */
  done: Promise<void>;
}

/** What one agent's run lets the team do: its signal, its event sink, and what it has left. */
export interface TeamBinding {
  readonly signal: AbortSignal | undefined;
  readonly emit: (event: AgentEvent) => void;
  /** Tool calls this agent has made so far in the run. */
  readonly callsSoFar: () => number;
  readonly maxToolCalls: number | undefined;
  /** The wall-clock moment the run must be over by, when it has a limit. */
  readonly deadlineAt: number | undefined;
  /** The current access token, read when a child starts. */
  readonly token: () => string | undefined;
}

/** What `createAgent` hands a child so it joins its parent's team rather than founding one. */
export interface TeamLink {
  readonly hub: TeamHub;
  readonly name: string;
  readonly depth: number;
}

/** What every agent of one run shares. */
export interface TeamHub {
  readonly lead: string;
  readonly maxConcurrent: number;
  readonly runKey: string;
  readonly stateDirectory: string;
  readonly bus: TeamBus;
  /** Every child of the run, whoever started it. */
  readonly children: Map<string, TeamChild>;
  /** Children started so far, queued or not. */
  spawned: number;
  /** Children holding a working slot. */
  active: number;
  /** Starts of children waiting for a slot. */
  readonly queue: (() => void)[];
}

/** Makes an agent from a configuration; injected so this module does not import `createAgent`. */
export type AgentFactory = (config: AgentConfig) => Agent;

/** One agent's view of its team. */
export interface AgentTeam {
  /** The `agent.team` tool for the grants given, or undefined when none of its operations is offered. */
  toolkit(
    grants: readonly AgentToolCategory[],
    approve: TeamApprover | undefined,
  ): AgentToolkit | undefined;
  attach(binding: TeamBinding): void;
  /** Tool calls set aside for children still working plus those finished children spent: not this agent's to spend. */
  callsHeld(): number;
  /** Cancels what is still running below this agent and removes its worktrees. Never throws. */
  close(): Promise<void>;
}

/** The parent's own approver, which a child's approvals are sent to. */
export type TeamApprover = (call: {
  readonly toolName: string;
  readonly operation: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly category: AgentToolCategory;
}) => boolean | Promise<boolean>;

/** Everything one child's run needs, gathered when it is spawned. */
export interface ChildLaunch {
  readonly hub: TeamHub;
  readonly child: TeamChild;
  readonly factory: AgentFactory;
  readonly config: AgentConfig;
  readonly prompt: string;
  readonly maxToolCalls: number;
  /** Tells the team's agent about an event, whichever run it is in. */
  readonly emit: (event: AgentEvent) => void;
  readonly parentName: string;
  /** Called once when the child is over, to wake whoever waits. */
  readonly settle: () => void;
}

/** One agent's working state: what it was configured with, who it is, and what it started. */
export interface TeamContext {
  readonly config: AgentConfig;
  readonly factory: AgentFactory;
  readonly hub: TeamHub;
  readonly self: string;
  readonly depth: number;
  /** The children this agent started. */
  readonly mine: Map<string, TeamChild>;
  readonly launches: Map<string, ChildLaunch>;
  grants: readonly AgentToolCategory[];
  binding: TeamBinding | undefined;
}
