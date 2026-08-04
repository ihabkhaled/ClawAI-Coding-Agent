import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { describeRuntimeTarget } from '../../src/infrastructure/vscode-runtime-target-adapter';
import { ExecutionTargetRegistry } from '../../src/services/execution-target-registry';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { RuntimeHostProbe } from '../../src/infrastructure/vscode-runtime-target.types';

const localProbe: RuntimeHostProbe = {
  architecture: 'x64',
  extensionKind: 'workspace',
  extensionVersion: '0.41.0',
  platform: 'win32',
  remoteName: undefined,
  shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  uiKind: 'desktop',
  vscodeVersion: '1.110.0',
  workspaceFolders: [{ name: 'ClawAI', scheme: 'file', uri: 'file:///D:/Freelance/Claw' }],
  workspaceTrusted: true,
  prerequisites: {
    browser: false,
    container: false,
    database: false,
    elevation: false,
    git: true,
    process: true,
  },
};

function invocationFor(toolName: string, targetId: string): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:00000001',
    runId: 'run:00000001',
    turnId: 'turn:00000001',
    toolName,
    toolVersion: '1.0',
    operation: 'read',
    arguments: {},
    targetId,
    epochs: { account: 0, workspace: 0, target: 0, policy: 0 },
    idempotencyKey: 'idem:00000001',
    requestedAt: '2026-08-04T00:00:00.000Z',
  };
}

function registryWithLocalTarget(): {
  readonly registry: ExecutionTargetRegistry;
  readonly targetId: string;
} {
  const registry = new ExecutionTargetRegistry({
    cancelTarget: async () => undefined,
    cleanupOwnedProcesses: async () => undefined,
  });
  const target = { ...describeRuntimeTarget(localProbe) };
  target.capabilities = [...target.capabilities, 'workspace.files'];
  registry.register(
    target,
    { networkReachability: 'workspace-only', browserAvailability: 'none' },
    0,
  );
  return { registry, targetId: target.id };
}

describe('ExecutionTargetRegistry', () => {
  it('dispatches a trusted local workspace tool while the internet is unreachable', () => {
    const { registry, targetId } = registryWithLocalTarget();

    const selected = registry.select(invocationFor('workspace.files', targetId));

    expect(selected.state).toBe('online');
    expect(selected.networkReachability).toBe('workspace-only');
  });

  it('keeps execution state independent from network reachability', () => {
    const { registry, targetId } = registryWithLocalTarget();

    const [registered] = registry.list();

    expect(registered?.target.id).toBe(targetId);
    expect(registered?.state).toBe('online');
    expect(registered?.networkReachability).not.toBe('internet');
  });

  it('refuses a capability the target does not advertise', () => {
    const { registry, targetId } = registryWithLocalTarget();

    expect(() => registry.select(invocationFor('workspace.browser', targetId))).toThrow(
      /does not provide the requested capability/u,
    );
  });

  it('refuses a stale target epoch', () => {
    const { registry, targetId } = registryWithLocalTarget();
    const invocation = invocationFor('workspace.files', targetId);

    expect(() =>
      registry.select({ ...invocation, epochs: { ...invocation.epochs, target: 1 } }),
    ).toThrow(/epoch is stale/u);
  });

  it('refuses dispatch to a target that is not execution-ready', () => {
    const registry = new ExecutionTargetRegistry({
      cancelTarget: async () => undefined,
      cleanupOwnedProcesses: async () => undefined,
    });
    const rootless = describeRuntimeTarget({ ...localProbe, workspaceFolders: [] });
    registry.register(
      { ...rootless, capabilities: [...rootless.capabilities, 'workspace.files'] },
      { networkReachability: 'workspace-only', browserAvailability: 'none' },
      0,
    );

    expect(() => registry.select(invocationFor('workspace.files', rootless.id))).toThrow(
      /Execution target is offline/u,
    );
  });
});
