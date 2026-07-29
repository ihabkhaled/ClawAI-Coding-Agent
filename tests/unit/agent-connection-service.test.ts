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
    approvalRequest: undefined,
    backendStatus: 'disconnected',
    backendUrl: configuration.backendUrl,
    busy: false,
    connected: false,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: undefined, pending: [] },
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
    accountBoundary,
    activeBackend,
    authorization,
    candidateBackend,
    configurationService,
    createBackend,
    extensionState,
    refreshData,
    replaceBackend,
    service,
    sessionVault,
    setConfiguration(next: Partial<RuntimeConfiguration>) {
      currentConfiguration = { ...currentConfiguration, ...next };
    },
  };
}

describe('AgentConnectionService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('migrates a legacy session only after an endpoint was explicitly configured', async () => {
    const subject = harness();

    await subject.service.initialize();

    expect(subject.sessionVault.migrateLegacy).toHaveBeenCalledWith('https://claw.local');
    expect(subject.sessionVault.load).not.toHaveBeenCalled();
  });

  it('discards an unattributed legacy session even when no endpoint is configured', async () => {
    const subject = harness();
    subject.configurationService.hasConfiguredBackendUrl.mockReturnValueOnce(false);

    await subject.service.initialize();

    expect(subject.sessionVault.clearLegacy).toHaveBeenCalledOnce();
    expect(subject.sessionVault.migrateLegacy).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot.connected).toBe(false);
  });

  it('contains legacy-secret cleanup failures inside the activation error boundary', async () => {
    const subject = harness();
    subject.sessionVault.clearLegacy.mockRejectedValueOnce(new Error('SecretStorage unavailable'));

    await expect(subject.service.initialize()).resolves.toBeUndefined();

    expect(subject.sessionVault.migrateLegacy).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'error',
      busy: false,
      connected: false,
      lastError: 'SecretStorage unavailable',
    });
  });

  it('fails into reconnect state instead of aborting activation when SecretStorage is unavailable', async () => {
    const subject = harness();
    subject.sessionVault.migrateLegacy.mockRejectedValueOnce(
      new Error('SecretStorage unavailable'),
    );

    await expect(subject.service.initialize()).resolves.toBeUndefined();

    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'error',
      connected: false,
      lastError: 'SecretStorage unavailable',
    });
  });

  it('authorizes a candidate and persists the endpoint only after success', async () => {
    const subject = harness();

    await subject.service.connect('https://new.example');

    expect(subject.authorization.signIn).toHaveBeenCalledWith(subject.candidateBackend);
    expect(subject.configurationService.saveBackendUrl).toHaveBeenCalledWith('https://new.example');
    expect(subject.sessionVault.replaceIfCurrent).toHaveBeenCalledWith(
      'https://new.example',
      authorizedTokens,
      0,
    );
    expect(subject.authorization.signIn.mock.invocationCallOrder[0]).toBeLessThan(
      subject.configurationService.saveBackendUrl.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rolls back candidate credentials when persisting the endpoint fails', async () => {
    const subject = harness();
    subject.configurationService.saveBackendUrl.mockRejectedValueOnce(
      new Error('configuration unavailable'),
    );

    await subject.service.connect('https://claw.local/');

    expect(subject.sessionVault.rollbackReplacement).toHaveBeenCalledWith('https://claw.local', 0);
    expect(subject.sessionVault.finalizeReplacement).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot.connected).toBe(false);
  });

  it('rolls back candidate credentials when activating the endpoint fails', async () => {
    const subject = harness();
    subject.replaceBackend.mockImplementationOnce(() => {
      throw new Error('backend activation failed');
    });

    await subject.service.connect('https://claw.local/');

    expect(subject.sessionVault.rollbackReplacement).toHaveBeenCalledWith('https://claw.local', 0);
    expect(subject.sessionVault.finalizeReplacement).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot.connected).toBe(false);
  });

  it('preserves the active endpoint when candidate authorization fails', async () => {
    const subject = harness();
    subject.authorization.signIn.mockRejectedValueOnce(new Error('authorization failed'));

    await subject.service.connect('https://new.example');

    expect(subject.configurationService.saveBackendUrl).not.toHaveBeenCalled();
    expect(subject.replaceBackend).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot.backendUrl).toBe('https://claw.local');
    expect(subject.extensionState.snapshot.connected).toBe(false);
  });

  it('does not mutate an existing origin-scoped session when candidate authorization fails', async () => {
    const subject = harness();
    const previous = {
      accessToken: 'previous-access',
      refreshToken: 'previous-refresh',
      expiresIn: 900,
      refreshExpiresIn: 2_592_000,
      tokenType: 'Bearer' as const,
    };
    subject.sessionVault.load.mockResolvedValueOnce(previous);
    subject.authorization.signIn.mockRejectedValueOnce(new Error('authorization failed'));

    await subject.service.connect('https://new.example');

    expect(subject.sessionVault.replaceIfCurrent).not.toHaveBeenCalled();
    expect(subject.sessionVault.clear).not.toHaveBeenCalled();
  });

  it('coalesces duplicate Connect requests into one authorization attempt', async () => {
    const subject = harness();
    let complete:
      | ((authorization: { tokens: typeof authorizedTokens; user: { id: string } }) => void)
      | undefined;
    subject.authorization.signIn.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );

    const first = subject.service.connect('https://new.example');
    const second = subject.service.connect('https://new.example');
    complete?.({ tokens: authorizedTokens, user: { id: 'user-1' } });
    await Promise.all([first, second]);

    expect(subject.authorization.signIn).toHaveBeenCalledOnce();
    expect(subject.configurationService.saveBackendUrl).toHaveBeenCalledOnce();
  });

  it('does not activate a candidate cancelled after profile validation while tokens are saving', async () => {
    const subject = harness();
    let finishSave: (() => void) | undefined;
    subject.sessionVault.replaceIfCurrent.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishSave = () => {
          resolve(1);
        };
      }),
    );
    const connecting = subject.service.connect('https://new.example');
    await vi.waitFor(() => {
      expect(subject.sessionVault.replaceIfCurrent).toHaveBeenCalledOnce();
    });

    await subject.service.cancelConnection();
    finishSave?.();
    await connecting;

    expect(subject.configurationService.saveBackendUrl).not.toHaveBeenCalled();
    expect(subject.sessionVault.rollbackReplacement).toHaveBeenCalledWith('https://new.example', 0);
    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'disconnected',
      connected: false,
      user: undefined,
    });
  });

  it('does not start browser authorization after logout during generation capture', async () => {
    const subject = harness();
    let finishCapture: ((generation: number) => void) | undefined;
    subject.sessionVault.captureGeneration.mockReturnValueOnce(
      new Promise((resolve) => {
        finishCapture = resolve;
      }),
    );
    const connecting = subject.service.connect('https://new.example');
    await vi.waitFor(() => {
      expect(subject.sessionVault.captureGeneration).toHaveBeenCalledOnce();
    });

    await subject.service.logout();
    finishCapture?.(0);
    await connecting;

    expect(subject.authorization.signIn).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot.connected).toBe(false);
  });

  it('does not activate a candidate when logout starts while candidate tokens are saving', async () => {
    const subject = harness();
    let finishSave: (() => void) | undefined;
    subject.sessionVault.replaceIfCurrent.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishSave = () => {
          resolve(1);
        };
      }),
    );
    const connecting = subject.service.connect('https://new.example');
    await vi.waitFor(() => {
      expect(subject.sessionVault.replaceIfCurrent).toHaveBeenCalledOnce();
    });

    await subject.service.logout();
    finishSave?.();
    await connecting;

    expect(subject.configurationService.saveBackendUrl).not.toHaveBeenCalled();
    expect(subject.sessionVault.rollbackReplacement).toHaveBeenCalledWith('https://new.example', 0);
    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'disconnected',
      connected: false,
      user: undefined,
    });
  });

  it('restores the connection form after timeout and accepts an immediate fresh attempt', async () => {
    const subject = harness();
    subject.authorization.signIn
      .mockRejectedValueOnce(new Error('ClawAI authorization timed out. Please try again.'))
      .mockResolvedValueOnce({ tokens: authorizedTokens, user: { id: 'user-1' } });

    await subject.service.connect('https://new.example');

    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'error',
      busy: false,
      connected: false,
      lastError: 'ClawAI authorization timed out. Please try again.',
    });

    await subject.service.connect('https://new.example');

    expect(subject.authorization.signIn).toHaveBeenCalledTimes(2);
    expect(subject.configurationService.saveBackendUrl).toHaveBeenCalledOnce();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'connected',
      busy: false,
      connected: true,
      lastError: undefined,
    });
  });

  it('disconnects and clears old-account state when settings change the backend origin', async () => {
    const subject = harness();
    subject.extensionState.update({
      backendStatus: 'connected',
      connected: true,
      history: [{ id: 'old-thread', title: 'Old account' }] as never,
      user: { id: 'old-user' } as never,
    });
    subject.setConfiguration({ backendUrl: 'https://other.example' });

    await subject.service.configurationChanged();

    expect(subject.accountBoundary).toHaveBeenCalledOnce();
    expect(subject.refreshData).not.toHaveBeenCalled();
    expect(subject.replaceBackend).toHaveBeenCalledOnce();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://other.example',
      backendStatus: 'disconnected',
      connected: false,
      history: [],
      user: undefined,
    });
  });

  it('restores a previously authorized origin only after validating its stored session', async () => {
    const subject = harness();
    subject.sessionVault.load.mockResolvedValueOnce(authorizedTokens);
    subject.setConfiguration({ backendUrl: 'https://other.example' });

    await subject.service.configurationChanged();

    expect(subject.candidateBackend.getProfile).toHaveBeenCalledOnce();
    expect(subject.refreshData).toHaveBeenCalledOnce();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://other.example',
      backendStatus: 'connected',
      connected: true,
      user: { id: 'restored-user' },
    });
  });

  it('cannot finish restoring a configured origin after logout starts', async () => {
    const subject = harness();
    let completeProfile: ((user: { id: string }) => void) | undefined;
    subject.sessionVault.load.mockResolvedValueOnce(authorizedTokens);
    subject.candidateBackend.getProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        completeProfile = resolve;
      }),
    );
    subject.setConfiguration({ backendUrl: 'https://other.example' });
    const restoring = subject.service.configurationChanged();
    await vi.waitFor(() => {
      expect(subject.candidateBackend.getProfile).toHaveBeenCalledOnce();
    });

    await subject.service.logout();
    completeProfile?.({ id: 'stale-user' });
    await restoring;

    expect(subject.extensionState.snapshot).toMatchObject({
      backendStatus: 'disconnected',
      connected: false,
      user: undefined,
    });
  });

  it('cannot activate an old authorization after settings switch endpoints during finalize', async () => {
    const subject = harness();
    let finishFinalize: ((finalized: boolean) => void) | undefined;
    subject.sessionVault.finalizeReplacement.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFinalize = resolve;
      }),
    );
    const connecting = subject.service.connect('https://new.example');
    await vi.waitFor(() => {
      expect(subject.sessionVault.finalizeReplacement).toHaveBeenCalledOnce();
    });

    subject.setConfiguration({ backendUrl: 'https://third.example' });
    await subject.service.configurationChanged();
    finishFinalize?.(true);
    await connecting;

    expect(subject.sessionVault.invalidate).toHaveBeenCalledWith('https://new.example');
    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://third.example',
      backendStatus: 'disconnected',
      connected: false,
      user: undefined,
    });
  });

  it('cannot finish initialization after the configured origin changes', async () => {
    const subject = harness();
    let completeProfile: ((user: { id: string }) => void) | undefined;
    subject.sessionVault.migrateLegacy.mockResolvedValueOnce(authorizedTokens);
    subject.activeBackend.getProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        completeProfile = resolve;
      }),
    );
    const initializing = subject.service.initialize();
    await vi.waitFor(() => {
      expect(subject.activeBackend.getProfile).toHaveBeenCalledOnce();
    });

    subject.setConfiguration({ backendUrl: 'https://other.example' });
    await subject.service.configurationChanged();
    completeProfile?.({ id: 'stale-user' });
    await initializing;

    expect(subject.refreshData).not.toHaveBeenCalled();
    expect(subject.extensionState.snapshot).toMatchObject({
      backendUrl: 'https://other.example',
      backendStatus: 'disconnected',
      connected: false,
      user: undefined,
    });
  });
});
