import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentToolCategory } from './workspace-toolkit.types';
import type { PermissionMode } from '../core/permission-policy.types';
import type { OperationClassification } from '../core/runtime/runtime-operation-classification';

/** What a mode does with one call: run it, put it to the approver, or never offer it. */
export type ToolDecision = 'allow' | 'ask' | 'deny';

/** One decision per permission mode. */
export type ToolDecisions = Readonly<Record<AgentPermissionMode, ToolDecision>>;

/**
 * Why the SDK and the editor's policy give different answers for a call.
 *
 * - `READ_NEVER_ASKED`: the SDK never asks about a read in any mode, the editor's
 *   Ask and Strict ask about reads too. The SDK is the looser of the two.
 * - `PLAN_WITHHOLDS_CATEGORY`: the SDK's plan mode withholds a whole category
 *   (it has no per-operation view), the editor lets a read-only operation of it
 *   run. The SDK is the stricter of the two.
 */
export type EditorDifference = 'READ_NEVER_ASKED' | 'PLAN_WITHHOLDS_CATEGORY';

/** One tool operation and what every mode does with it. This is the single source of truth. */
export interface ToolPermissionRow {
  readonly tool: string;
  readonly operation: string;
  readonly category: AgentToolCategory;
  /** What the editor's policy needs to see; undefined means the editor's own table has the row. */
  readonly classification?: OperationClassification;
  readonly decisions: ToolDecisions;
  /** The modes in which the editor's decision differs from `decisions`, and why. Every other mode must agree. */
  readonly editorDiffers: Readonly<Partial<Record<AgentPermissionMode, EditorDifference>>>;
}

/** The SDK mode name and the editor's name for it (the Approval dropdown's option values). */
export type EditorModeNames = Readonly<Record<AgentPermissionMode, PermissionMode>>;
