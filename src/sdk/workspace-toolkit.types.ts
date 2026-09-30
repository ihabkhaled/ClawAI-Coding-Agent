import type { AgentToolCall } from './agent-sdk.types';
import type { NoteAddedInfo, NotesStore } from './notes-tool.types';
import type { WriteScopeListener } from './write-scope.types';

/** The kinds of work a run can be granted, one flag each; `git-write` is commit, push and the other git operations that change something; `mcp` is the configured MCP servers. */
export type AgentToolCategory = 'read' | 'write' | 'command' | 'git' | 'git-write' | 'mcp';

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
  readonly approve?: ((request: AgentApprovalRequest) => boolean | Promise<boolean>) | undefined;
}

/** The working memory a toolkit writes to; without a store the notes last only as long as the toolkit. */
export interface WorkspaceMemory {
  readonly store?: NotesStore | undefined;
  readonly onNoteAdded?: ((info: NoteAddedInfo) => void) | undefined;
  /** Told when the write scope refuses a change or undoes one. */
  readonly onWriteScopeViolation?: WriteScopeListener | undefined;
}
