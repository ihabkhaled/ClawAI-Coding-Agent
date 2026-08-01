import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { AgentConnectionService } from '../../src/services/agent-connection-service';

import type { TokenPair } from '../../src/core/session-vault';
import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 200_000,
  maxContextFiles: 40,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

const authorizedTokens = {
  accessToken: 'authorized-access',
  refreshToken: 'authorized-refresh',
  expiresIn: 900,
  refreshExpiresIn: 2_592_000,
  tokenType: 'Bearer' as const,
};

function state() {
  return new ExtensionState({
    agentMode: 'AUTO',
    agentRun: undefined,
    agentRuns: {},
    approvalRequest: undefined,
    backendStatus: 'disconnected',
    backendUrl: configuration.backendUrl,
    busy: false,
    connected: false,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    history: [],
    lastError: undefined,
    modelWarnings: [],
    models: [],
    permissionMode: 'MANUAL',
    routingMode: 'AUTO',
    selectedModel: '',
    usage: undefined,
    user: undefined,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
  });
}

function harness() {
  const extensionState = state();
  let currentConfiguration = { ...configuration };
  const activeBackend = {
    getProfile: vi.fn(async () => ({ id: 'active-user' })),
    logout: vi.fn(async () => undefined),
  };
  const candidateBackend = {
    getProfile: vi.fn(async () => ({ id: 'restored-user' })),
    logout: vi.fn(async () => undefined),
  };
  let selectedBackend: object = activeBackend;
  const configurationService = {
    hasConfiguredBackendUrl: vi.fn(() => true),
    read: vi.fn(() => currentConfiguration),
    saveBackendUrl: vi.fn(async (backendUrl: string) => {
      currentConfiguration = { ...currentConfiguration, backendUrl };
      return backendUrl;
    }),
  };
  const authorization = {
    cancel: vi.fn(() => false),
    setBackend: vi.fn(),
    setFrontendUrl: vi.fn(),
    signIn: vi.fn(async () => ({ tokens: authorizedTokens, user: { id: 'user-1' } })),
  };
  const createBackend = vi.fn(() => candidateBackend);
  const replaceBackend = vi.fn(() => {
    selectedBackend = candidateBackend;
  });
  const refreshData = vi.fn(async () => undefined);
  const accountBoundary = vi.fn();
  let sessionGeneration = 0;
  const sessionVault = {
    captureGeneration: vi.fn(async () => sessionGeneration),
    clearLegacy: vi.fn(async () => undefined),
    clear: vi.fn(async () => {
      sessionGeneration += 1;
    }),
    invalidate: vi.fn(async () => {
      sessionGeneration += 1;
    }),
    finalizeReplacement: vi.fn(async () => true),
    load: vi.fn(async (): Promise<TokenPair | null> => null),
    migrateLegacy: vi.fn(async (): Promise<TokenPair | null> => null),
    replaceIfCurrent: vi.fn(
      async (_backendUrl: string, _tokens: TokenPair, expectedGeneration: number) => {
        if (sessionGeneration !== expectedGeneration) {
          return null;
        }
        sessionGeneration += 1;
        return sessionGeneration;
      },
    ),
    rollbackReplacement: vi.fn(async () => undefined),
    save: vi.fn(),
  };
  const service = new AgentConnectionService(
    extensionState,
    sessionVault as never,
    { error: vi.fn(), warn: vi.fn() } as never,
    configurationService as never,
    authorization as never,
    { setBackend: vi.fn() } as never,
    { setBackend: vi.fn() } as never,
    () => selectedBackend as never,
    createBackend as never,
    replaceBackend,
    refreshData,
    () => null,
    accountBoundary,
  );
  return {
    activeBackend,
    extensionState,
    service,
    sessionVault,
    setConfiguration(next: Partial<RuntimeConfiguration>) {
      currentConfiguration = { ...currentConfiguration, ...next };
    },
  };
}

describe('AgentConnectionService session boundaries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not disconnect a newer session when stale initialization finds no tokens', async () => {
    const subject = harness();
    let finishMigration: ((tokens: TokenPair | null) => void) | undefined;
    subject.sessionVault.migrateLegacy.mockReturnValueOnce(
      new Promise((resolve) => {
        finishMigration = resolve;
      }),
    );
    const initializing = subject.service.initialize();
    await vi.waitFor(() => {
      expect(subject.sessionVault.migrateLegacy).toHaveBeenCalledOnce();
    });

    await subject.service.connect('https://new.example');
    finishMigration?.(null);
    await initializing;

    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://new.example',
      backendStatus: 'connected',
      connected: true,
      user: { id: 'user-1' },
    });
  });

  it('does not disconnect a newer session when stale restore finds no tokens', async () => {
    const subject = harness();
    let finishLoad: ((tokens: TokenPair | null) => void) | undefined;
    subject.sessionVault.load.mockReturnValueOnce(
      new Promise((resolve) => {
        finishLoad = resolve;
      }),
    );
    subject.setConfiguration({ backendUrl: 'https://other.example' });
    const restoring = subject.service.configurationChanged();
    await vi.waitFor(() => {
      expect(subject.sessionVault.load).toHaveBeenCalledOnce();
    });

    await subject.service.connect('https://new.example');
    finishLoad?.(null);
    await restoring;

    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://new.example',
      backendStatus: 'connected',
      connected: true,
      user: { id: 'user-1' },
    });
  });

  it('clears local account state even when remote logout is offline', async () => {
    const subject = harness();
    subject.extensionState.update({
      agentRun: { phase: 'generating' } as never,
      backendStatus: 'connected',
      connected: true,
      contextReceipt: { included: ['private.ts'] } as never,
      user: { id: 'user-1' } as never,
    });
    subject.activeBackend.logout.mockRejectedValueOnce(new Error('offline'));

    await expect(subject.service.logout()).resolves.toBeUndefined();

    expect(subject.sessionVault.clearLegacy).toHaveBeenCalled();
    expect(subject.sessionVault.clear).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'disconnected',
      connected: false,
      agentRun: undefined,
      contextReceipt: undefined,
      user: undefined,
    });
  });

  it('clears local account state before remote logout finishes', async () => {
    const subject = harness();
    let finishLogout: (() => void) | undefined;
    subject.extensionState.update({
      backendStatus: 'connected',
      connected: true,
      user: { id: 'user-1' } as never,
    });
    subject.activeBackend.logout.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finishLogout = () => {
          resolve(undefined);
        };
      }),
    );

    const loggingOut = subject.service.logout();
    await vi.waitFor(() => {
      expect(subject.extensionState.snapshot.connected).toBe(false);
    });

    expect(subject.extensionState.snapshot.user).toBeUndefined();
    finishLogout?.();
    await loggingOut;
  });
});
