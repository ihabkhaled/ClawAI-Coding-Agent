import { describe, expect, it, vi } from 'vitest';

import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function adapter(repository: string | undefined, approve = vi.fn(async () => true)) {
  return new RuntimePolicyV2Adapter(
    {
      accountId: () => 'account:test',
      backendOrigin: () => 'https://claw.local',
      workspaceId: () => 'workspace:test',
      workspaceRoot: () => 'D:/workspace',
      mode: () => 'AUTONOMOUS_SCOPED',
      workspaceTrusted: () => true,
      userPresent: () => true,
      organizationPolicy: () => ({
        allowedTools: [],
        maximumRisk: 'R4',
        deniedEffects: [],
        requireApproval: ['local-mutation'],
        trust: { repositories: [['github.com/acme/*']], domains: [], commands: [] },
      }),
      repository: () => repository,
      approve,
    },
    {
      load: async () => ({ deniedEffects: [], maximumRisk: 'R4', requireApproval: [], rules: [] }),
    },
  );
}

const invocation: ToolInvocation = {
  schemaVersion: '2.0',
  invocationId: 'invocation:trust',
  runId: 'runtime:trust',
  turnId: 'turn:trust',
  toolName: 'runtime.integration',
  toolVersion: '2.0.0',
  operation: 'integrate',
  arguments: {},
  targetId: 'target:workspace',
  epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
  idempotencyKey: 'idempotency:trust',
  requestedAt: '2026-09-29T12:00:00.000Z',
};

describe('RuntimePolicyV2Adapter repository trust', () => {
  it('denies an untrusted repository before asking anyone', async () => {
    const approve = vi.fn(async () => true);
    const decision = await adapter('github.com/evil/app', approve).evaluate(invocation);
    expect(decision).toMatchObject({ decision: 'deny', code: 'ORGANIZATION_REPOSITORY_UNTRUSTED' });
    expect(approve).not.toHaveBeenCalled();
  });

  it('carries the repository through approval and capability consumption', async () => {
    const approve = vi.fn(async () => true);
    const policy = adapter('github.com/acme/app', approve);
    expect(await policy.evaluate(invocation)).toMatchObject({ decision: 'allow' });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.objectContaining({ repository: 'github.com/acme/app' }),
      }),
      undefined,
    );
    expect(() => {
      policy.consumeCapability(invocation);
    }).not.toThrow();
  });
});
