import type { AgentMode } from './agent-mode.types';

export type PermissionMode =
  | 'PLAN'
  | 'ASK'
  | 'AUTO_EDIT'
  | 'AUTONOMOUS_SCOPED'
  | 'ENTERPRISE_LOCKED'
  | 'BYPASS_PERMISSIONS'
  | 'EDIT_AUTOMATICALLY'
  | 'MANUAL';
export type PermissionOperation =
  'commandExecution' | 'editGeneration' | 'externalFinalDiff' | 'finalDiff' | 'workspaceContext';
export type PermissionOutcome = 'allow' | 'ask' | 'deny';
export type PermissionReason =
  | 'commandReviewRequired'
  | 'finalDiffRequired'
  | 'externalFinalDiffRequired'
  | 'fullAccess'
  | 'manualApproval'
  | 'planReadOnly'
  | 'sensitivePath'
  | 'sessionApproval'
  | 'workspaceUntrusted';

export interface PermissionInput {
  agentMode: AgentMode;
  operation: PermissionOperation;
  permissionMode: PermissionMode;
  sensitive: boolean;
  trusted: boolean;
}

export interface PermissionDecision {
  outcome: PermissionOutcome;
  reason: PermissionReason;
}
