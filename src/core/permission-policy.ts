import type { PermissionDecision, PermissionInput } from './permission-policy.types';

export function decidePermission(input: PermissionInput): PermissionDecision {
  if (input.sensitive) {
    return { outcome: 'deny', reason: 'sensitivePath' };
  }
  if (!input.trusted && input.operation !== 'workspaceContext') {
    return { outcome: 'deny', reason: 'workspaceUntrusted' };
  }
  if (
    input.agentMode === 'PLAN' &&
    (input.operation === 'commandExecution' || input.operation === 'editGeneration')
  ) {
    return { outcome: 'deny', reason: 'planReadOnly' };
  }
  if (input.operation === 'finalDiff') {
    return input.permissionMode === 'BYPASS_PERMISSIONS'
      ? { outcome: 'allow', reason: 'fullAccess' }
      : { outcome: 'ask', reason: 'finalDiffRequired' };
  }
  if (input.operation === 'commandExecution') {
    return { outcome: 'ask', reason: 'commandReviewRequired' };
  }
  if (input.permissionMode === 'MANUAL') {
    return { outcome: 'ask', reason: 'manualApproval' };
  }
  if (input.permissionMode === 'EDIT_AUTOMATICALLY') {
    return { outcome: 'allow', reason: 'sessionApproval' };
  }
  return { outcome: 'allow', reason: 'fullAccess' };
}
