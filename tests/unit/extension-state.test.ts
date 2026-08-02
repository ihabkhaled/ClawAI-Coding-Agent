import { describe, expect, it, vi } from 'vitest';

import { ExtensionState, type ExtensionSnapshot } from '../../src/core/extension-state';
import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { parseRuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

const initialSnapshot: ExtensionSnapshot = {
  agentRun: undefined,
  agentRuns: {},
  agentMode: 'AUTO',
  approvalRequest: undefined,
  backendUrl: 'https://claw.example',
  backendStatus: 'disconnected',
  busy: false,
  connected: false,
  generationQueue: {
    active: [],
    capacity: 2,
    pending: [],
  },
  routingMode: 'AUTO',
  runtime: createRuntimeSnapshot(),
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
  workspaceScope: {
    folders: [],
  },
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

  it('applies parsed runtime events through the canonical reducer and publishes them', () => {
    const state = new ExtensionState(initialSnapshot);
    const listener = vi.fn();
    state.subscribe(listener);

    state.applyRuntimeEvent({
      schemaVersion: '2.0',
      eventId: 'event-id-0001',
      runId: 'run-id-0001',
      sequence: 0,
      timestamp: '2026-08-02T10:00:00.000Z',
      type: 'run.created',
      visibility: 'user',
      sensitivity: 'workspace',
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      payload: {},
    });

    expect(state.snapshot.runtime.runs['run-id-0001']?.status).toBe('running');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() => {
      state.applyRuntimeEvent({ unexpected: true });
    }).toThrow();
    expect(
      parseRuntimeEvent(state.snapshot.runtime.runs['run-id-0001']?.timeline[0]),
    ).toBeDefined();
  });

  it('does not publish an identical replay and can reset account-scoped runtime state', () => {
    const state = new ExtensionState(initialSnapshot);
    const listener = vi.fn();
    state.subscribe(listener);
    const runtimeEvent = {
      schemaVersion: '2.0',
      eventId: 'event-id-0001',
      runId: 'run-id-0001',
      sequence: 0,
      timestamp: '2026-08-02T10:00:00.000Z',
      type: 'run.created',
      visibility: 'user',
      sensitivity: 'workspace',
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      payload: {},
    };

    state.applyRuntimeEvent(runtimeEvent);
    state.applyRuntimeEvent(runtimeEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    state.resetRuntime();
    expect(state.snapshot.runtime).toEqual(createRuntimeSnapshot());
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
