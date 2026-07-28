import { describe, expect, it, vi } from 'vitest';

import { ExtensionState, type ExtensionSnapshot } from '../../src/core/extension-state';

const initialSnapshot: ExtensionSnapshot = {
  agentMode: 'AUTO',
  backendUrl: 'https://claw.example',
  backendStatus: 'disconnected',
  busy: false,
  connected: false,
  routingMode: 'AUTO',
  selectedModel: '',
  modelWarnings: [],
  models: [],
  permissionMode: 'MANUAL',
  history: [],
  user: undefined,
  entitlements: undefined,
  usage: undefined,
  contextReceipt: undefined,
  workspaceReadiness: undefined,
  lastError: undefined,
};

describe('ExtensionState', () => {
  it('publishes the initial snapshot, merges updates, and supports unsubscribe', () => {
    const state = new ExtensionState(initialSnapshot);
    const listener = vi.fn();
    const unsubscribe = state.subscribe(listener);

    expect(listener).toHaveBeenLastCalledWith(initialSnapshot);
    state.update({ connected: true, backendStatus: 'connected' });
    expect(state.snapshot).toMatchObject({
      connected: true,
      backendStatus: 'connected',
      backendUrl: 'https://claw.example',
    });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    state.update({ busy: true });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
