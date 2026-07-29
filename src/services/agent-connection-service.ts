import * as vscode from 'vscode';

import type { BrowserAuthorizationService } from './browser-authorization-service';
import type { ChatService } from './chat-service';
import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { ModelService } from './model-service';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { OutputLogger } from '../infrastructure/output-logger';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export class AgentConnectionService {
  constructor(
    private readonly state: ExtensionState,
    private readonly sessionVault: SessionVault,
    private readonly logger: OutputLogger,
    private readonly configuration: ConfigurationService,
    private readonly authorization: BrowserAuthorizationService,
    private readonly chat: ChatService,
    private readonly models: ModelService,
    private readonly backend: () => BackendClient,
    private readonly replaceBackend: (configuration: RuntimeConfiguration) => void,
    private readonly refreshData: () => Promise<void>,
    private readonly view: () => ChatViewProvider | null,
  ) {}

  async initialize(): Promise<void> {
    if (!this.configuration.hasConfiguredBackendUrl()) {
      const configured = await this.configuration.promptForBackendUrl();
      if (configured === null) {
        this.markDisconnected();
        return;
      }
      await this.configurationChanged();
    }
    const tokens = await this.sessionVault.load();
    if (tokens === null) {
      this.markDisconnected();
      return;
    }
    await this.run(async () => {
      const user = await this.backend().getProfile();
      this.state.update({
        backendStatus: 'connected',
        connected: true,
        user,
      });
      await this.refreshData();
    });
  }

  async configurationChanged(): Promise<void> {
    const configuration = this.configuration.read();
    this.replaceBackend(configuration);
    this.authorization.setBackend(this.backend());
    this.chat.setBackend(this.backend());
    this.models.setBackend(this.backend());
    this.state.update({
      agentMode: configuration.agentMode,
      backendUrl: configuration.backendUrl,
      permissionMode: configuration.permissionMode,
      routingMode: configuration.routingMode,
      selectedModel: configuration.selectedModel,
    });
    if (this.state.snapshot.connected) {
      await this.refreshData();
    }
  }

  async connect(): Promise<void> {
    if (!this.configuration.hasConfiguredBackendUrl()) {
      const configured = await this.configuration.promptForBackendUrl();
      if (configured === null) {
        return;
      }
      await this.configurationChanged();
    }
    await this.run(async () => {
      const user = await this.authorization.signIn();
      this.state.update({
        backendStatus: 'connected',
        connected: true,
        lastError: undefined,
        user,
      });
      await this.refreshData();
    });
  }

  async logout(): Promise<void> {
    await this.run(async () => {
      await this.backend().logout();
      this.state.update({
        backendStatus: 'disconnected',
        connected: false,
        entitlements: undefined,
        history: [],
        modelWarnings: [],
        models: [],
        selectedModel: '',
        usage: undefined,
        user: undefined,
      });
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
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI operation failed.');
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
}
