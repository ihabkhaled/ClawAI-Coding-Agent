import type { AgentMode } from './agent-mode.types';

export type PermissionMode = 'BYPASS_PERMISSIONS' | 'EDIT_AUTOMATICALLY' | 'MANUAL';
export type PermissionOperation = 'editGeneration' | 'finalDiff' | 'workspaceContext';
export type PermissionOutcome = 'allow' | 'ask' | 'deny';
export type PermissionReason =
  | 'finalDiffRequired'
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
