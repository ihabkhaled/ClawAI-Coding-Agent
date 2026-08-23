import { connectionOperationErrorMessage } from '../backend/backend-error-message';
import { isBackendSessionBoundaryError } from '../backend/backend-errors';
import { normalizeBackendUrl } from '../core/configuration';

import { AuthorizationCancelledError } from './browser-authorization-service';

import type { BrowserAuthorizationService } from './browser-authorization-service';
import type { ChatService } from './chat-service';
import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { ModelService } from './model-service';
import type { RuntimeProtocolService } from './runtime-protocol-service';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export class AgentConnectionService {
  private committingBackendUrl: string | null = null;
  private configurationEpoch = 0;
  private connectPromise: Promise<void> | null = null;
  private connectingBackendUrl: string | null = null;
  private lifecycleEpoch = 0;

  constructor(
    private readonly state: ExtensionState,
    private readonly sessionVault: SessionVault,
    private readonly logger: OutputLogger,
    private readonly configuration: ConfigurationService,
    private readonly authorization: BrowserAuthorizationService,
    private readonly chat: ChatService,
    private readonly models: ModelService,
    private readonly backend: () => BackendClient,
    private readonly createBackend: (configuration: RuntimeConfiguration) => BackendClient,
    private readonly replaceBackend: (configuration: RuntimeConfiguration) => void,
    private readonly runtimeProtocol: RuntimeProtocolService,
    private readonly refreshData: () => Promise<void>,
    private readonly view: () => ChatViewProvider | null,
    private readonly accountBoundary: () => Promise<void> | void,
  ) {}

  async initialize(): Promise<void> {
    this.authorization.setFrontendUrl(
      this.configuration.read().frontendUrl ?? 'https://claw.local',
    );
    await this.run(async () => {
      await this.sessionVault.clearLegacy();
    });
    if (this.state.snapshot.lastError !== undefined) {
      return;
    }
    if (!this.configuration.hasConfiguredBackendUrl()) {
      this.markDisconnected();
      return;
    }
    const configurationEpoch = this.configurationEpoch;
    const lifecycleEpoch = this.lifecycleEpoch;
    const backendUrl = this.configuration.read().backendUrl;
    const backend = this.backend();
    await this.run(async () => {
      const tokens = await this.sessionVault.migrateLegacy(backendUrl);
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      if (tokens === null) {
        this.markDisconnected();
        return;
      }
      const user = await backend.getProfile();
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      const protocolSelection = await this.runtimeProtocol.negotiate();
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      this.state.setRuntimeProtocolSelection(protocolSelection);
      this.state.update({
        backendStatus: 'connected',
        connected: true,
        user,
      });
      await this.refreshData();
    });
  }

  async configurationChanged(): Promise<void> {
    const configurationEpoch = ++this.configurationEpoch;
    const configuration = this.configuration.read();
    const endpointChanged =
      normalizeBackendUrl(configuration.backendUrl) !==
      normalizeBackendUrl(this.state.snapshot.backendUrl);
    if (endpointChanged) {
      if (this.committingBackendUrl !== normalizeBackendUrl(configuration.backendUrl)) {
        await this.cancelPendingConnection();
      }
      await this.accountBoundary();
    }
    this.replaceBackend(configuration);
    this.authorization.setBackend(this.backend());
    this.authorization.setFrontendUrl(configuration.frontendUrl ?? 'https://claw.local');
    this.chat.setBackend(this.backend());
    this.models.setBackend(this.backend());
    this.state.update({
      agentMode: configuration.agentMode,
      backendCustomUrl: configuration.backendCustomUrl,
      backendEnvironment: configuration.backendEnvironment,
      backendUrl: configuration.backendUrl,
      frontendCustomUrl: configuration.frontendCustomUrl,
      frontendEnvironment: configuration.frontendEnvironment,
      frontendUrl: configuration.frontendUrl,
      ...(endpointChanged
        ? {
            agentRun: undefined,
            backendStatus: 'disconnected' as const,
            connected: false,
            contextReceipt: undefined,
            entitlements: undefined,
            history: [],
            lastError: undefined,
            modelWarnings: [],
            models: [],
            usage: undefined,
            user: undefined,
          }
        : {}),
      permissionMode: configuration.permissionMode,
      routingMode: configuration.routingMode,
      selectedModel: configuration.selectedModel,
    });
    if (endpointChanged) {
      if (this.committingBackendUrl !== normalizeBackendUrl(configuration.backendUrl)) {
        await this.restoreConfiguredSession(configuration.backendUrl, configurationEpoch);
      }
      return;
    }
    if (this.state.snapshot.connected) {
      const protocolSelection = await this.runtimeProtocol.negotiate();
      if (configurationEpoch !== this.configurationEpoch) {
        return;
      }
      this.state.setRuntimeProtocolSelection(protocolSelection);
      await this.refreshData();
    }
  }

  connect(backendUrl: string): Promise<void> {
    if (this.connectPromise !== null) {
      return this.connectPromise;
    }
    const normalized = normalizeBackendUrl(backendUrl);
    const promise = this.connectOnce(normalized).finally(() => {
      if (this.connectPromise === promise) {
        this.connectPromise = null;
      }
    });
    this.connectPromise = promise;
    return promise;
  }

  cancelConnection(): Promise<boolean> {
    return this.cancelPendingConnection();
  }

  refresh(): Promise<void> {
    return this.run(this.refreshData);
  }

  private async connectOnce(backendUrl: string): Promise<void> {
    const lifecycleEpoch = ++this.lifecycleEpoch;
    this.connectingBackendUrl = backendUrl;
    try {
      await this.run(async () => {
        const generation = await this.sessionVault.captureGeneration(backendUrl);
        this.requireCurrent(lifecycleEpoch);
        const currentConfiguration = this.configuration.read();
        const candidateConfiguration = { ...currentConfiguration, backendUrl };
        const candidate = this.createBackend(candidateConfiguration);
        const authorized = await this.authorization.signIn(candidate);
        this.requireCurrent(lifecycleEpoch);
        let replacementCommitted = false;
        try {
          const committedGeneration = await this.sessionVault.replaceIfCurrent(
            backendUrl,
            authorized.tokens,
            generation,
            // Stamp the account onto the shared session record. Another window
            // that later finds this session can then adopt it instead of
            // treating it as a stranger and dropping to the Connect gate.
            authorized.user.id,
          );
          if (committedGeneration === null) {
            throw new AuthorizationCancelledError();
          }
          replacementCommitted = true;
          this.requireCurrent(lifecycleEpoch);
          this.committingBackendUrl = backendUrl;
          await this.configuration.saveBackendUrl(backendUrl);
          this.requireCurrent(lifecycleEpoch);
          await this.configurationChanged();
          this.requireCurrent(lifecycleEpoch);
          const finalized = await this.sessionVault.finalizeReplacement(
            backendUrl,
            committedGeneration,
          );
          if (!finalized) {
            throw new AuthorizationCancelledError();
          }
          replacementCommitted = false;
          this.requireCurrent(lifecycleEpoch);
        } catch (error: unknown) {
          if (replacementCommitted) {
            await this.sessionVault.rollbackReplacement(backendUrl, generation);
          }
          throw error;
        }
        const protocolSelection = await this.runtimeProtocol.negotiate();
        this.requireCurrent(lifecycleEpoch);
        this.state.setRuntimeProtocolSelection(protocolSelection);
        this.state.update({
          backendStatus: 'connected',
          connected: true,
          lastError: undefined,
          user: authorized.user,
        });
        this.connectingBackendUrl = null;
        await this.refreshData();
      });
    } finally {
      if (this.committingBackendUrl === backendUrl) {
        this.committingBackendUrl = null;
      }
      if (this.connectingBackendUrl === backendUrl) {
        this.connectingBackendUrl = null;
      }
    }
  }

  async logout(): Promise<void> {
    if (this.connectingBackendUrl === null) {
      this.lifecycleEpoch += 1;
      this.authorization.cancel();
    } else {
      await this.cancelPendingConnection();
    }
    this.configurationEpoch += 1;
    await this.run(async () => {
      await this.accountBoundary();
      this.clearAccountState();
      try {
        await this.sessionVault.clearLegacy();
      } catch (error: unknown) {
        this.logger.warn('ClawAI legacy session cleanup failed during logout.', error);
      }
      try {
        await this.backend().logout();
      } catch (error: unknown) {
        this.logger.warn('ClawAI remote logout failed; local session was cleared.', error);
      }
    });
  }

  private clearAccountState(): void {
    this.state.update({
      agentRun: undefined,
      backendStatus: 'disconnected',
      connected: false,
      contextReceipt: undefined,
      entitlements: undefined,
      history: [],
      modelWarnings: [],
      models: [],
      selectedModel: '',
      usage: undefined,
      user: undefined,
      lastError: undefined,
    });
  }

  async run(action: () => Promise<void>): Promise<void> {
    this.state.update({
      backendStatus: this.state.snapshot.connected ? 'connected' : 'loading',
      busy: true,
      lastError: undefined,
    });
    try {
      await action();
    } catch (error: unknown) {
      if (error instanceof AuthorizationCancelledError) {
        this.state.update({
          backendStatus: this.state.snapshot.connected ? 'connected' : 'disconnected',
          lastError: undefined,
        });
        return;
      }
      if (isBackendSessionBoundaryError(error)) {
        await this.accountBoundary();
        this.clearAccountState();
        this.state.update({
          backendStatus: 'disconnected',
          lastError: error.message,
        });
        await this.view()?.postError(error.message);
        return;
      }
      const message = connectionOperationErrorMessage(error);
      this.logger.error('ClawAI operation failed.', error);
      this.state.update({
        backendStatus: this.state.snapshot.connected ? 'connected' : 'error',
        lastError: message,
      });
      await this.view()?.postError(message);
    } finally {
      this.state.update({ busy: false });
    }
  }

  private markDisconnected(): void {
    this.state.update({
      backendStatus: 'disconnected',
      connected: false,
    });
  }

  private async restoreConfiguredSession(
    backendUrl: string,
    configurationEpoch: number,
  ): Promise<void> {
    const lifecycleEpoch = this.lifecycleEpoch;
    const backend = this.backend();
    await this.run(async () => {
      const tokens = await this.sessionVault.load(backendUrl);
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      if (tokens === null) {
        this.markDisconnected();
        return;
      }
      const user = await backend.getProfile();
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      const protocolSelection = await this.runtimeProtocol.negotiate();
      if (!this.isCurrent(configurationEpoch, lifecycleEpoch, backendUrl)) {
        return;
      }
      this.state.setRuntimeProtocolSelection(protocolSelection);
      this.state.update({
        backendStatus: 'connected',
        connected: true,
        lastError: undefined,
        user,
      });
      await this.refreshData();
    });
  }

  private async cancelPendingConnection(): Promise<boolean> {
    const pending = this.connectingBackendUrl;
    if (pending === null) {
      return this.authorization.cancel();
    }
    this.connectingBackendUrl = null;
    this.lifecycleEpoch += 1;
    this.authorization.cancel();
    await this.sessionVault.invalidate(pending);
    return true;
  }

  private isCurrent(
    configurationEpoch: number,
    lifecycleEpoch: number,
    backendUrl: string,
  ): boolean {
    return (
      configurationEpoch === this.configurationEpoch &&
      lifecycleEpoch === this.lifecycleEpoch &&
      normalizeBackendUrl(this.state.snapshot.backendUrl) === normalizeBackendUrl(backendUrl)
    );
  }

  private requireCurrent(lifecycleEpoch: number): void {
    if (lifecycleEpoch !== this.lifecycleEpoch) {
      throw new AuthorizationCancelledError();
    }
  }
}
