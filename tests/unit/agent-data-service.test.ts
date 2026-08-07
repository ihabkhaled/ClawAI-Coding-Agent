import { describe, expect, it, vi } from 'vitest';

import { AccountEpoch } from '../../src/core/account-epoch';
import { ExtensionState } from '../../src/core/extension-state';
import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { refreshAgentData, refreshConversationData } from '../../src/services/agent-data-service';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: (value: T) => resolve?.(value) };
}

describe('refreshAgentData', () => {
  it('falls back in view state without mutating a newer persisted model selection', async () => {
    const state = new ExtensionState({
      agentMode: 'AUTO',
      effortMode: 'ULTRA',
      agentRun: undefined,
      agentRuns: {},
      approvalRequest: undefined,
      backendStatus: 'connected',
      backendUrl: 'https://claw.local',
      busy: false,
      connected: true,
      contextReceipt: undefined,
      entitlements: undefined,
      generationQueue: { active: [], capacity: 2, pending: [] },
      history: [],
      lastError: undefined,
      modelWarnings: [],
      models: [],
      permissionMode: 'MANUAL',
      routingMode: 'MANUAL_MODEL',
      runtime: createRuntimeSnapshot(),
      selectedModel: 'OLLAMA:removed',
      usage: undefined,
      user: { id: 'user-1' } as never,
      workspaceReadiness: undefined,
      workspaceScope: { folders: [] },
    });
    const selectAuto = vi.fn(async () => undefined);
    const configuration = {
      read: vi.fn(() => ({
        historyLimit: 50,
        routingMode: 'MANUAL_MODEL',
        selectedModel: 'OLLAMA:removed',
      })),
      selectAuto,
    };

    await refreshAgentData(
      {
        getUsage: vi.fn(async () => ({ day: { used: 1 } })),
        listThreads: vi.fn(async () => []),
      } as never,
      configuration as never,
      {
        refresh: vi.fn(async () => ({
          catalog: [],
          entitlements: undefined,
          warnings: [],
        })),
      } as never,
      state,
      new AccountEpoch(),
    );

    expect(selectAuto).not.toHaveBeenCalled();
    expect(state.snapshot).toMatchObject({ routingMode: 'AUTO', selectedModel: '' });
  });

  it('cannot repopulate old-account state after an account boundary', async () => {
    const modelResult = deferred<{
      catalog: never[];
      entitlements: undefined;
      warnings: never[];
    }>();
    const state = new ExtensionState({
      agentMode: 'AUTO',
      effortMode: 'ULTRA',
      agentRun: undefined,
      agentRuns: {},
      approvalRequest: undefined,
      backendStatus: 'connected',
      backendUrl: 'https://claw.local',
      busy: false,
      connected: true,
      contextReceipt: undefined,
      entitlements: undefined,
      generationQueue: { active: [], capacity: 2, pending: [] },
      history: [],
      lastError: undefined,
      modelWarnings: [],
      models: [],
      permissionMode: 'MANUAL',
      routingMode: 'AUTO',
      runtime: createRuntimeSnapshot(),
      selectedModel: '',
      usage: undefined,
      user: { id: 'old-user' } as never,
      workspaceReadiness: undefined,
      workspaceScope: { folders: [] },
    });
    const epoch = new AccountEpoch();
    const configuration = {
      read: vi.fn(() => ({ historyLimit: 50, routingMode: 'AUTO', selectedModel: '' })),
      selectAuto: vi.fn(async () => undefined),
    };
    const refreshing = refreshAgentData(
      {
        getUsage: vi.fn(async () => ({ day: { used: 99 } })),
        listThreads: vi.fn(async () => [{ id: 'old-thread', title: 'Old account' }]),
      } as never,
      configuration as never,
      { refresh: vi.fn(() => modelResult.promise) } as never,
      state,
      epoch,
    );

    epoch.invalidate();
    state.update({ backendStatus: 'disconnected', connected: false, history: [], user: undefined });
    modelResult.resolve({ catalog: [], entitlements: undefined, warnings: [] });
    await refreshing;

    expect(configuration.selectAuto).not.toHaveBeenCalled();
    expect(state.snapshot).toMatchObject({
      backendStatus: 'disconnected',
      connected: false,
      history: [],
      usage: undefined,
      user: undefined,
    });
  });

  it('cannot restore old history when post-run refresh crosses an account boundary', async () => {
    const history = deferred<{ id: string; title: string }[]>();
    const state = new ExtensionState({
      agentMode: 'AUTO',
      effortMode: 'ULTRA',
      agentRun: undefined,
      agentRuns: {},
      approvalRequest: undefined,
      backendStatus: 'connected',
      backendUrl: 'https://claw.local',
      busy: false,
      connected: true,
      contextReceipt: undefined,
      entitlements: undefined,
      generationQueue: { active: [], capacity: 2, pending: [] },
      history: [],
      lastError: undefined,
      modelWarnings: [],
      models: [],
      permissionMode: 'MANUAL',
      routingMode: 'AUTO',
      runtime: createRuntimeSnapshot(),
      selectedModel: '',
      usage: undefined,
      user: { id: 'old-user' } as never,
      workspaceReadiness: undefined,
      workspaceScope: { folders: [] },
    });
    const epoch = new AccountEpoch();
    const refreshing = refreshConversationData(
      {
        getUsage: vi.fn(async () => ({ day: { used: 99 } })),
        listThreads: vi.fn(() => history.promise),
      } as never,
      50,
      state,
      epoch,
    );

    epoch.invalidate();
    state.update({ backendStatus: 'disconnected', connected: false, history: [], user: undefined });
    history.resolve([{ id: 'old-thread', title: 'Old account' }]);
    await refreshing;

    expect(state.snapshot).toMatchObject({
      connected: false,
      history: [],
      usage: undefined,
      user: undefined,
    });
  });

  it('does not let an older overlapping refresh overwrite newer conversation data', async () => {
    const firstHistory = deferred<{ id: string; title: string }[]>();
    const secondHistory = deferred<{ id: string; title: string }[]>();
    const firstUsage = deferred<{ day: { used: number } }>();
    const secondUsage = deferred<{ day: { used: number } }>();
    const backend = {
      getUsage: vi
        .fn()
        .mockReturnValueOnce(firstUsage.promise)
        .mockReturnValueOnce(secondUsage.promise),
      listThreads: vi
        .fn()
        .mockReturnValueOnce(firstHistory.promise)
        .mockReturnValueOnce(secondHistory.promise),
    };
    const state = new ExtensionState({
      agentMode: 'AUTO',
      effortMode: 'ULTRA',
      agentRun: undefined,
      agentRuns: {},
      approvalRequest: undefined,
      backendStatus: 'connected',
      backendUrl: 'https://claw.local',
      busy: false,
      connected: true,
      contextReceipt: undefined,
      entitlements: undefined,
      generationQueue: { active: [], capacity: 2, pending: [] },
      history: [],
      lastError: undefined,
      modelWarnings: [],
      models: [],
      permissionMode: 'MANUAL',
      routingMode: 'AUTO',
      runtime: createRuntimeSnapshot(),
      selectedModel: '',
      usage: undefined,
      user: { id: 'user-1' } as never,
      workspaceReadiness: undefined,
      workspaceScope: { folders: [] },
    });
    const accountEpoch = new AccountEpoch();
    const refreshEpoch = new AccountEpoch();

    const older = refreshConversationData(
      backend as never,
      50,
      state,
      accountEpoch,
      undefined,
      refreshEpoch,
    );
    const newer = refreshConversationData(
      backend as never,
      50,
      state,
      accountEpoch,
      undefined,
      refreshEpoch,
    );
    secondHistory.resolve([{ id: 'new-thread', title: 'New' }]);
    secondUsage.resolve({ day: { used: 2 } });
    await newer;
    firstHistory.resolve([{ id: 'old-thread', title: 'Old' }]);
    firstUsage.resolve({ day: { used: 1 } });
    await older;

    expect(state.snapshot.history).toEqual([{ id: 'new-thread', title: 'New' }]);
    expect(state.snapshot.usage).toEqual({ day: { used: 2 } });
  });
});
