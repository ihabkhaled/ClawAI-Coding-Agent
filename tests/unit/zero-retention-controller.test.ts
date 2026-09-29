import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ConfigurationEvent {
  affectsConfiguration(key: string): boolean;
}

const setting = { value: false };
const configurationListeners: ((event: ConfigurationEvent) => void)[] = [];

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: () => setting.value,
    }),
    onDidChangeConfiguration: (listener: (event: ConfigurationEvent) => void) => {
      configurationListeners.push(listener);
      return { dispose: vi.fn() };
    },
  },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { ZeroRetentionPostureStore } from '../../src/core/zero-retention-posture';
import { ZeroRetentionController } from '../../src/services/zero-retention-controller';

import type { OrganizationPolicy } from '../../src/backend/contracts';

function policy(days: number): OrganizationPolicy {
  return {
    allowedTools: [],
    allowedModels: [],
    maximumRisk: 'R2',
    deniedEffects: [],
    requireApproval: [],
    maximumRetentionDays: days,
    minimumPermissionMode: null,
  };
}

function state(organizationPolicy: OrganizationPolicy | undefined): ExtensionState {
  return new ExtensionState({
    agentMode: 'AUTO',
    viewDensity: 'full',
    effortMode: 'ULTRA',
    speedMode: '1X',
    agentRun: undefined,
    agentRuns: {},
    approvalRequest: undefined,
    questionRequest: undefined,
    findings: [],
    tasks: [],
    artifacts: [],
    organizationPolicy,
    backendStatus: 'disconnected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: false,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    history: [],
    lastError: undefined,
    models: [],
    modelWarnings: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    runtime: createRuntimeSnapshot(),
    selectedModel: '',
    usage: undefined,
    user: undefined,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
  });
}

function changeSetting(affected: boolean): void {
  for (const listener of configurationListeners) {
    listener({ affectsConfiguration: (key) => affected && key === 'clawAI.zeroDataRetention' });
  }
}

describe('ZeroRetentionController', () => {
  beforeEach(() => {
    setting.value = false;
    configurationListeners.length = 0;
  });

  it('starts from the setting and follows it when it changes', () => {
    setting.value = true;
    const store = new ZeroRetentionPostureStore();
    const controller = new ZeroRetentionController(state(undefined), store);
    expect(store.current()).toEqual({ active: true, source: 'setting' });

    setting.value = false;
    changeSetting(true);
    expect(store.active()).toBe(false);
    controller.dispose();
  });

  it('ignores unrelated setting changes', () => {
    const store = new ZeroRetentionPostureStore();
    const controller = new ZeroRetentionController(state(undefined), store);
    setting.value = true;
    changeSetting(false);
    expect(store.active()).toBe(false);
    controller.dispose();
  });

  it('is forced on when the organization policy arrives with a zero-day ceiling', () => {
    const store = new ZeroRetentionPostureStore();
    const extensionState = state(policy(30));
    const controller = new ZeroRetentionController(extensionState, store);
    expect(store.active()).toBe(false);

    extensionState.update({ organizationPolicy: policy(0) });
    expect(store.current()).toEqual({ active: true, source: 'organization' });

    extensionState.update({ busy: true });
    expect(store.current()).toEqual({ active: true, source: 'organization' });

    extensionState.update({ organizationPolicy: undefined });
    expect(store.active()).toBe(false);
    controller.dispose();
  });
});
