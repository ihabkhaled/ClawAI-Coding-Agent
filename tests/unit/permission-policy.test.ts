import { describe, expect, it } from 'vitest';

import { decidePermission } from '../../src/core/permission-policy';

describe('permission policy', () => {
  it.each(['MANUAL', 'EDIT_AUTOMATICALLY', 'BYPASS_PERMISSIONS'] as const)(
    'requires explicit approval for external output diffs in %s mode',
    (permissionMode) => {
      expect(
        decidePermission({
          agentMode: 'AUTO',
          operation: 'externalFinalDiff',
          permissionMode,
          sensitive: false,
          trusted: true,
        }),
      ).toEqual({ outcome: 'ask', reason: 'externalFinalDiffRequired' });
    },
  );
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
    ).toEqual({ outcome: 'allow', reason: 'scopedAccess' });
  });

  it('keeps Plan mode read-only and auto-applies final diffs only in Full Access', () => {
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
    ).toEqual({ outcome: 'allow', reason: 'scopedAccess' });
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

  it.each(['EDIT_AUTOMATICALLY', 'BYPASS_PERMISSIONS'] as const)(
    'requires explicit command review in %s mode',
    (permissionMode) => {
      expect(
        decidePermission({
          agentMode: 'AUTO',
          operation: 'commandExecution',
          permissionMode,
          sensitive: false,
          trusted: true,
        }),
      ).toEqual({ outcome: 'ask', reason: 'commandReviewRequired' });
    },
  );

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

  describe('every Approval option, by its label', () => {
    const base = { agentMode: 'AUTO', sensitive: false, trusted: true } as const;

    it('Plan allows read-only workspace context and denies edits and commands', () => {
      const plan = { ...base, permissionMode: 'PLAN' } as const;
      expect(decidePermission({ ...plan, operation: 'workspaceContext' })).toEqual({
        outcome: 'allow',
        reason: 'planReadContext',
      });
      for (const operation of ['editGeneration', 'commandExecution'] as const) {
        expect(decidePermission({ ...plan, operation })).toEqual({
          outcome: 'deny',
          reason: 'planReadOnly',
        });
      }
    });

    it('Plan does not read context in an untrusted workspace', () => {
      expect(
        decidePermission({
          ...base,
          trusted: false,
          permissionMode: 'PLAN',
          operation: 'workspaceContext',
        }),
      ).toEqual({ outcome: 'deny', reason: 'planReadOnly' });
    });

    it('Ask asks for context and edits with the manual reason', () => {
      for (const operation of ['workspaceContext', 'editGeneration'] as const) {
        expect(decidePermission({ ...base, permissionMode: 'ASK', operation })).toEqual({
          outcome: 'ask',
          reason: 'manualApproval',
        });
      }
    });

    it('Auto Edit pre-approves context and edits but asks for commands and final diffs', () => {
      const auto = { ...base, permissionMode: 'AUTO_EDIT' } as const;
      expect(decidePermission({ ...auto, operation: 'editGeneration' }).outcome).toBe('allow');
      expect(decidePermission({ ...auto, operation: 'commandExecution' }).outcome).toBe('ask');
      expect(decidePermission({ ...auto, operation: 'finalDiff' }).outcome).toBe('ask');
    });

    it('Autonomous Scoped works in the workspace but still asks for commands and external output', () => {
      const scoped = { ...base, permissionMode: 'AUTONOMOUS_SCOPED' } as const;
      expect(decidePermission({ ...scoped, operation: 'editGeneration' })).toEqual({
        outcome: 'allow',
        reason: 'scopedAccess',
      });
      expect(decidePermission({ ...scoped, operation: 'commandExecution' }).outcome).toBe('ask');
      expect(decidePermission({ ...scoped, operation: 'externalFinalDiff' }).outcome).toBe('ask');
      expect(decidePermission({ ...scoped, trusted: false, operation: 'editGeneration' })).toEqual({
        outcome: 'deny',
        reason: 'workspaceUntrusted',
      });
    });

    it('Strict asks for every operation with a reason of its own, unlike Ask', () => {
      for (const operation of ['workspaceContext', 'editGeneration', 'commandExecution'] as const) {
        expect(
          decidePermission({ ...base, permissionMode: 'ENTERPRISE_LOCKED', operation }),
        ).toEqual({ outcome: 'ask', reason: 'strictApproval' });
        expect(decidePermission({ ...base, permissionMode: 'ASK', operation }).reason).not.toBe(
          'strictApproval',
        );
      }
    });
  });
});
