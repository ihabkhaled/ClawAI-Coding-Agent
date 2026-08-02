import { describe, expect, it, vi } from 'vitest';

import { flagshipRequestSchema } from '../../src/core/flagship-delivery';
import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

describe('RuntimePolicyV2Adapter effect classification', () => {
  it.each([
    ['runtime.integration', 'integrate'],
    ['runtime.flagship', 'run'],
    ['workspace.git', 'stage'],
    ['workspace.git', 'commit'],
    ['workspace.git', 'merge'],
    ['workspace.git', 'rebase'],
    ['workspace.git', 'cherry-pick'],
    ['workspace.git', 'revert'],
  ])('requires explicit approval for %s.%s', async (toolName, operation) => {
    const approve = vi.fn(async () => true);
    const adapter = service(approve);

    await expect(adapter.evaluate(invocation(toolName, operation))).resolves.toMatchObject({
      decision: 'allow',
    });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ risk: 'R3', effect: 'local-mutation' }),
      undefined,
    );
  });

  it('classifies elevation as an immutable R4 consent boundary', async () => {
    const approve = vi.fn(async () => true);

    await service(approve).evaluate(invocation('runtime.elevation', 'execute'));

    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ risk: 'R4', effect: 'elevation' }),
      undefined,
    );
  });

  it('does not accept model-authored flagship authorization flags', () => {
    expect(() =>
      flagshipRequestSchema.parse({
        deliveryId: 'flagship-policy-test',
        runId: 'runtime-policy-test',
        goal: 'Test trusted authorization.',
        strategy: 'cross-stack-feature',
        repositories: ['workspace-root'],
        budget: {
          maxRuntimeMs: 60_000,
          maxStageAttempts: 1,
          maxModelTurns: 10,
          maxToolCalls: 20,
          maxSubAgents: 1,
        },
        effects: { commitAuthorized: true },
      }),
    ).toThrow();
  });
});

function service(approve: (request: unknown, signal?: AbortSignal) => Promise<boolean>) {
  return new RuntimePolicyV2Adapter(
    {
      accountId: () => 'account:test',
      backendOrigin: () => 'https://claw.local',
      workspaceId: () => 'workspace:test',
      workspaceRoot: () => 'D:/workspace',
      mode: () => 'AUTONOMOUS_SCOPED',
      workspaceTrusted: () => true,
      userPresent: () => true,
      approve,
    },
    { load: async () => ({ deniedEffects: [], maximumRisk: 'R4', requireApproval: [] }) },
  );
}

function invocation(toolName: string, operation: string): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: `invocation:${toolName}:${operation}`,
    runId: 'runtime:policy-test',
    turnId: 'turn:policy-test',
    toolName,
    toolVersion: '2.0.0',
    operation,
    arguments: {},
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: `idempotency:${toolName}:${operation}`,
    requestedAt: '2026-08-02T12:00:00.000Z',
  };
}
