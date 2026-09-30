import type { PermissionDecision, PermissionInput } from './permission-policy.types';

function effectiveMode(mode: PermissionInput['permissionMode']): PermissionInput['permissionMode'] {
  if (mode === 'BYPASS_PERMISSIONS') return 'AUTONOMOUS_SCOPED';
  if (mode === 'EDIT_AUTOMATICALLY') return 'AUTO_EDIT';
  if (mode === 'MANUAL') return 'ASK';
  return mode;
}

function finalDiffDecision(input: PermissionInput): PermissionDecision | undefined {
  if (input.operation === 'externalFinalDiff') {
    return { outcome: 'ask', reason: 'externalFinalDiffRequired' };
  }
  if (input.operation !== 'finalDiff') return undefined;
  return effectiveMode(input.permissionMode) === 'AUTONOMOUS_SCOPED'
    ? { outcome: 'allow', reason: 'scopedAccess' }
    : { outcome: 'ask', reason: 'finalDiffRequired' };
}

/**
 * What each selected mode says once the guards above have passed.
 *
 * Strict asks every time with its own reason, so the caller never remembers an
 * earlier answer for it; Ask asks; Auto Edit pre-approves routine work;
 * Plan allows only read-only workspace context; Autonomous Scoped works inside
 * the workspace without asking (commands and external output still ask above).
 */
function modeOutcome(mode: PermissionInput['permissionMode'], input: PermissionInput): PermissionDecision {
  if (mode === 'ENTERPRISE_LOCKED') return { outcome: 'ask', reason: 'strictApproval' };
  if (mode === 'ASK') return { outcome: 'ask', reason: 'manualApproval' };
  if (mode === 'AUTO_EDIT') return { outcome: 'allow', reason: 'sessionApproval' };
  if (mode === 'PLAN') {
    return input.operation === 'workspaceContext' && input.trusted
      ? { outcome: 'allow', reason: 'planReadContext' }
      : { outcome: 'deny', reason: 'planReadOnly' };
  }
  return { outcome: 'allow', reason: 'scopedAccess' };
}

export function decidePermission(input: PermissionInput): PermissionDecision {
  const mode = effectiveMode(input.permissionMode);
  if (input.sensitive) {
    return { outcome: 'deny', reason: 'sensitivePath' };
  }
  if (!input.trusted && input.operation !== 'workspaceContext') {
    return { outcome: 'deny', reason: 'workspaceUntrusted' };
  }
  if (
    input.agentMode === 'PLAN' &&
    ['commandExecution', 'editGeneration'].includes(input.operation)
  ) {
    return { outcome: 'deny', reason: 'planReadOnly' };
  }
  const diffDecision = finalDiffDecision(input);
  if (diffDecision !== undefined) return diffDecision;
  if (mode === 'ENTERPRISE_LOCKED' || mode === 'PLAN') return modeOutcome(mode, input);
  if (input.operation === 'commandExecution') {
    return { outcome: 'ask', reason: 'commandReviewRequired' };
  }
  return modeOutcome(mode, input);
}
