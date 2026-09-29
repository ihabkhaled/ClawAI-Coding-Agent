import { describe, expect, it, vi } from 'vitest';

import {
  clampToOrganizationFloor,
  organizationCeilingOf,
} from '../../src/core/organization-permission-floor';
import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { PermissionMode } from '../../src/core/permission-policy.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

// ADR 0003: the organization policy is a ceiling no permission mode can exceed.
describe('permission modes under an organization ceiling (F046)', () => {
  it('ranks Strict between Plan and Ask, so a Plan ceiling holds it', () => {
    expect(clampToOrganizationFloor('ENTERPRISE_LOCKED', 'PLAN')).toBe('PLAN');
    expect(clampToOrganizationFloor('ENTERPRISE_LOCKED', 'ASK')).toBe('ENTERPRISE_LOCKED');
    expect(clampToOrganizationFloor('ENTERPRISE_LOCKED', null)).toBe('ENTERPRISE_LOCKED');
  });

  it('ranks legacy aliases with the mode they mean', () => {
    expect(clampToOrganizationFloor('BYPASS_PERMISSIONS', 'ASK')).toBe('ASK');
    expect(clampToOrganizationFloor('EDIT_AUTOMATICALLY', 'PLAN')).toBe('PLAN');
    expect(clampToOrganizationFloor('MANUAL', 'ASK')).toBe('MANUAL');
  });

  it('reads the ceiling from a policy of unknown shape', () => {
    expect(organizationCeilingOf({ minimumPermissionMode: 'ASK', allowedTools: [] })).toBe('ASK');
    expect(organizationCeilingOf({ minimumPermissionMode: null })).toBeUndefined();
    expect(organizationCeilingOf(undefined)).toBeUndefined();
    expect(organizationCeilingOf({ minimumPermissionMode: 'ENTERPRISE_LOCKED' })).toBeUndefined();
  });

  it.each([
    ['AUTONOMOUS_SCOPED', { minimumPermissionMode: 'ASK' }, 'ASK'],
    ['AUTONOMOUS_SCOPED', undefined, 'AUTONOMOUS_SCOPED'],
    ['AUTO_EDIT', { minimumPermissionMode: 'AUTONOMOUS_SCOPED' }, 'AUTO_EDIT'],
  ] as const)(
    'evaluates a configured %s under %j as %s, even when set outside the picker',
    async (configured, policy, expected) => {
      const approve = vi.fn(async () => true);
      await adapter(configured, policy, approve).evaluate(invocation());
      expect(approve).toHaveBeenCalledWith(expect.objectContaining({ mode: expected }), undefined);
    },
  );
});

function adapter(
  configured: PermissionMode,
  policy: unknown,
  approve: (request: unknown, signal?: AbortSignal) => Promise<boolean>,
) {
  return new RuntimePolicyV2Adapter(
    {
      accountId: () => 'account:test',
      backendOrigin: () => 'https://claw.local',
      workspaceId: () => 'workspace:test',
      workspaceRoot: () => 'D:/workspace',
      mode: () => configured,
      workspaceTrusted: () => true,
      userPresent: () => true,
      organizationPolicy: () => policy,
      approve,
    },
    {
      load: async () => ({ deniedEffects: [], maximumRisk: 'R4', requireApproval: [], rules: [] }),
    },
  );
}

function invocation(): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:ceiling',
    runId: 'runtime:ceiling-test',
    turnId: 'turn:ceiling-test',
    toolName: 'runtime.integration',
    toolVersion: '2.0.0',
    operation: 'integrate',
    arguments: {},
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:ceiling',
    requestedAt: '2026-09-29T12:00:00.000Z',
  };
}
