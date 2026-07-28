import { describe, expect, it } from 'vitest';

import { decidePermission } from '../../src/core/permission-policy';

describe('permission policy', () => {
  it('asks in Manual mode and pre-approves routine actions in higher modes', () => {
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'workspaceContext',
        permissionMode: 'MANUAL',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'ask', reason: 'manualApproval' });
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'editGeneration',
        permissionMode: 'EDIT_AUTOMATICALLY',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'allow', reason: 'sessionApproval' });
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'workspaceContext',
        permissionMode: 'BYPASS_PERMISSIONS',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'allow', reason: 'fullAccess' });
  });

  it('keeps Plan mode read-only and only bypasses final review in Full Access', () => {
    expect(
      decidePermission({
        agentMode: 'PLAN',
        operation: 'editGeneration',
        permissionMode: 'BYPASS_PERMISSIONS',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'deny', reason: 'planReadOnly' });
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'finalDiff',
        permissionMode: 'BYPASS_PERMISSIONS',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'allow', reason: 'fullAccess' });
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'finalDiff',
        permissionMode: 'EDIT_AUTOMATICALLY',
        sensitive: false,
        trusted: true,
      }),
    ).toEqual({ outcome: 'ask', reason: 'finalDiffRequired' });
  });

  it('denies sensitive and untrusted modifying operations in every mode', () => {
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'editGeneration',
        permissionMode: 'BYPASS_PERMISSIONS',
        sensitive: true,
        trusted: true,
      }),
    ).toEqual({ outcome: 'deny', reason: 'sensitivePath' });
    expect(
      decidePermission({
        agentMode: 'AUTO',
        operation: 'editGeneration',
        permissionMode: 'BYPASS_PERMISSIONS',
        sensitive: false,
        trusted: false,
      }),
    ).toEqual({ outcome: 'deny', reason: 'workspaceUntrusted' });
  });
});
