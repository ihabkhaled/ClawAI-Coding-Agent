import type { AgentToolCall } from './agent-sdk.types';
import type { NoteAddedInfo, NotesStore } from './notes-tool.types';
import type { ShellOptions } from './shell-tool.types';
import type { PlanStore, PlanSummary } from './task-plan-tool.types';
import type { WriteScopeListener } from './write-scope.types';

/** The kinds of work a run can be granted, one flag each; `git-write` is commit, push and the other git operations that change something; `mcp` is the configured MCP servers; `http` is GET and HEAD to the allowed hosts, `http-write` is POST, PUT, PATCH and DELETE; `browser` is the headless browser page tool; `shell` is `workspace.shell`, which also needs its own switch; `agents` is `agent.team`, whose children can never hold more than the parent. */
export type AgentToolCategory =
  | 'read'
  | 'write'
  | 'command'
  | 'git'
  | 'git-write'
  | 'mcp'
  | 'http'
  | 'http-write'
  | 'browser'
  | 'shell'
  | 'agents';

/** One tool call awaiting the caller's decision, with the category it falls in. */
export interface AgentApprovalRequest extends AgentToolCall {
  readonly category: AgentToolCategory;
}

/**
 * What a run may do on the caller's machine.
 *
 * `allow` decides what the model is offered at all; `approve`, when given, is
 * asked once per call inside that set. Withholding a category and declining a
 * call both reach the model as `PERMISSION_DENIED`, never as a crash.
 */
export interface AgentPermissions {
  readonly allow: readonly AgentToolCategory[];
  /** Added to the default command allowlist (node, npm, npx). */
  readonly allowedExecutables?: readonly string[] | undefined;
  /**
   * Workspace-relative globs (`*` in a segment, `**` across, `?`); when set, every
   * file and git change must match one and no `writeDeny` glob. See `write-scope.ts`.
   */
  readonly writeScope?: readonly string[] | undefined;
  /** Globs no change may match; wins over `writeScope`, and alone means "anywhere but here". */
  readonly writeDeny?: readonly string[] | undefined;
  /**
   * Offer every operation to the model even when only some are granted; the
   * withheld ones are refused on arrival as `PERMISSION_DENIED`. Plan mode sets
   * it: a model that asks for a write there gets a refusal it can answer with,
   * where an operation missing from the offered catalog would fail the run.
   */
  readonly offerRefused?: boolean | undefined;
  /** Hosts `http.request` may reach (`host`, `host:port`, `*.example.com`); none means the tool is not offered. */
  readonly httpAllowHosts?: readonly string[] | undefined;
  /**
   * The second switch for `workspace.shell` (the first is `shell` in `allow`). Present
   * means the operator opted in; absent means the shell does not exist for this run.
   * Every script is put to `approve`, and with no `approve` it is denied.
   */
  readonly shell?: ShellOptions | undefined;
  readonly approve?: ((request: AgentApprovalRequest) => boolean | Promise<boolean>) | undefined;
}

/** The working memory a toolkit writes to; without a store the notes last only as long as the toolkit. */
export interface WorkspaceMemory {
  readonly store?: NotesStore | undefined;
  readonly onNoteAdded?: ((info: NoteAddedInfo) => void) | undefined;
  /** The task plan a toolkit works on; without a store the plan lasts only as long as the toolkit. */
  readonly plan?: PlanStore | undefined;
  /** Told after every change to the task plan, with the new step counts. */
  readonly onPlanChanged?: ((summary: PlanSummary) => void) | undefined;
  /** Told when the write scope refuses a change or undoes one. */
  readonly onWriteScopeViolation?: WriteScopeListener | undefined;
  /** ADR-143: exported to `workspace.command` children only, and scrubbed from their output. */
  readonly secretEnvironment?: Readonly<Record<string, string>> | undefined;
}
