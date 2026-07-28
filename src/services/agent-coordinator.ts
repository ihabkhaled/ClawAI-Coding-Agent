import * as vscode from 'vscode';

import { BackendClient } from '../backend/backend-client';
import { type ContextMode } from '../core/context-mode';
import { type OutputLogger } from '../infrastructure/output-logger';
import { type VscodeWorkspaceEditAdapter } from '../infrastructure/vscode-workspace-edit-adapter';
import { type DiffPreviewProvider } from '../views/diff-preview-provider';
import { type ChatViewProvider } from '../webview/chat-view-provider';

import {
  contextualPrompt,
  currentModelSelection,
  formatCompareResponse,
  pickCompareInput,
  pickModelKey,
  promptQuestion,
  promptWorkflowRequest,
} from './agent-coordinator-prompts';
import { type CompareInput } from './agent-coordinator.types';
import { BrowserAuthorizationService } from './browser-authorization-service';
import { ChatParticipantService } from './chat-participant-service';
import { ChatService } from './chat-service';
import { ClawaiInitializer } from './clawai-initializer';
import { ConfigurationService, type RuntimeConfiguration } from './configuration-service';
import { ModelService } from './model-service';
import { confirmSafeEdits } from './safe-edit-confirmation';
import { SafeEditService } from './safe-edit-service';
import { SessionControlService } from './session-control-service';
import {
  buildAnalysisPrompt,
  buildWorkflowPrompt,
  parseWorkflowEditPlan,
  type WorkflowKind,
} from './workflow-service';

import type { WorkspaceContextService } from './workspace-context-service';
import type { CollectedContext } from '../core/context-collector';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';

export class AgentCoordinator implements vscode.Disposable {
  readonly browserAuthorization: BrowserAuthorizationService;
  readonly chatParticipant: ChatParticipantService;
  readonly sessionControls: SessionControlService;
  private backend: BackendClient;
  private readonly chat: ChatService;
  private readonly configuration = new ConfigurationService();
  private readonly initializer = new ClawaiInitializer();
  private readonly modelService: ModelService;
  private readonly safeEdits: SafeEditService;
  private activeAbort: AbortController | null = null;
  private activeThreadId: string | null = null;
  private view: ChatViewProvider | null = null;

  constructor(
    readonly state: ExtensionState,
    private readonly sessionVault: SessionVault,
    private readonly logger: OutputLogger,
    private readonly editAdapter: VscodeWorkspaceEditAdapter,
    private readonly diffPreview: DiffPreviewProvider,
    private readonly context: WorkspaceContextService,
  ) {
    this.backend = this.createBackend(this.configuration.read());
    this.browserAuthorization = new BrowserAuthorizationService(this.backend);
    this.chat = new ChatService(this.backend);
    this.modelService = new ModelService(this.backend);
    this.sessionControls = new SessionControlService(this.state, this.configuration);
    this.chatParticipant = new ChatParticipantService(
      this.state,
      this.logger,
      this.configuration,
      this.context,
      this.chat,
      this.sessionControls,
    );
    this.safeEdits = new SafeEditService(this.editAdapter, (previews, summary) =>
      confirmSafeEdits(this.diffPreview, previews, summary),
    );
  }

  attachView(view: ChatViewProvider): void {
    this.view = view;
  }

  async initialize(): Promise<void> {
    this.refreshWorkspaceReadiness();
    await vscode.commands.executeCommand(
      'setContext',
      'clawAI.workspaceTrusted',
      vscode.workspace.isTrusted,
    );
    if (!this.configuration.hasConfiguredBackendUrl()) {
      const configured = await this.configuration.promptForBackendUrl();
      if (configured === null) {
        this.state.update({
          backendStatus: 'disconnected',
          connected: false,
        });
        return;
      }
      await this.configurationChanged();
    }
    const tokens = await this.sessionVault.load();
    if (tokens === null) {
      this.state.update({
        backendStatus: 'disconnected',
        connected: false,
      });
      return;
    }
    await this.runOperation(async () => {
      const user = await this.backend.getProfile();
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
    this.backend = this.createBackend(configuration);
    this.replaceBackendPorts();
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

  async trustChanged(): Promise<void> {
    this.refreshWorkspaceReadiness();
    await vscode.commands.executeCommand(
      'setContext',
      'clawAI.workspaceTrusted',
      vscode.workspace.isTrusted,
    );
  }

  refreshWorkspaceReadiness(): void {
    this.state.update({
      workspaceReadiness: this.context.readiness(),
      workspaceScope: this.context.scopeSnapshot(),
    });
  }

  selectWorkspaceFolder(folderKey: string): void {
    this.context.selectWorkspaceFolder(folderKey);
    this.refreshWorkspaceReadiness();
  }

  async connect(): Promise<void> {
    if (!this.configuration.hasConfiguredBackendUrl()) {
      const configured = await this.configuration.promptForBackendUrl();
      if (configured === null) {
        return;
      }
      await this.configurationChanged();
    }
    await this.runOperation(async () => {
      const user = await this.browserAuthorization.signIn();
      this.state.update({
        backendStatus: 'connected',
        connected: true,
        user,
        lastError: undefined,
      });
      await this.refreshData();
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Connected to ClawAI as {0}.', user.email),
      );
    });
  }

  dispose(): void {
    this.browserAuthorization.dispose();
  }

  async logout(): Promise<void> {
    await this.runOperation(async () => {
      await this.backend.logout();
      this.state.update({
        backendStatus: 'disconnected',
        connected: false,
        history: [],
        modelWarnings: [],
        models: [],
        selectedModel: '',
        user: undefined,
        usage: undefined,
        entitlements: undefined,
      });
    });
  }

  async openChat(threadId?: string): Promise<void> {
    await this.view?.reveal();
    if (threadId === undefined || !this.state.snapshot.connected) {
      return;
    }
    await this.runOperation(async () => {
      const messages = await this.backend.listMessages(threadId, 100);
      const content = messages.map((message) => `${message.role}: ${message.content}`).join('\n\n');
      await this.view?.postResult({
        content,
        threadId,
      });
    });
  }

  async send(input: { content: string; contextMode: ContextMode }): Promise<void> {
    await this.runGeneration(async (abort) => {
      const collected = await this.collect(input.contextMode);
      const selection = currentModelSelection(
        this.configuration.read(),
        this.state.snapshot.models,
      );
      const result = await this.chat.send(
        {
          content: this.sessionControls.preparePrompt(input.content),
          context: collected.files,
          ...selection,
        },
        (event) => {
          void this.view?.postEvent(event);
        },
        abort.signal,
        (threadId) => {
          this.activeThreadId = threadId;
        },
      );
      await this.view?.postResult(result);
    });
  }

  async compare(input: CompareInput): Promise<void> {
    await this.runGeneration(async () => {
      const collected = await this.collect(input.contextMode);
      const models = input.modelKeys.map((key) => {
        const model = this.state.snapshot.models.find((entry) => entry.key === key);
        if (model === undefined) {
          throw new Error(vscode.l10n.t('One of the selected models is no longer available.'));
        }
        return {
          provider: model.provider,
          model: model.model,
        };
      });
      const response = await this.backend.compare({
        content: this.sessionControls.preparePrompt(
          contextualPrompt(input.content, collected.files),
        ),
        models,
        judgeEnabled: input.judgeEnabled,
        ...(input.judgeEnabled ? { judgeModel: input.modelKeys[0] ?? null } : {}),
      });
      await this.view?.postResult({
        content: formatCompareResponse(response),
        compare: response,
      });
    });
  }

  async compareModels(judgeEnabled = false): Promise<void> {
    const input = await pickCompareInput(this.state.snapshot.models, judgeEnabled);
    if (input === null) {
      return;
    }
    await this.compare({
      content: input.content,
      contextMode: 'file',
      modelKeys: input.modelKeys,
      judgeEnabled,
    });
  }

  async ask(contextMode: ContextMode): Promise<void> {
    const content = await promptQuestion();
    if (content === null) {
      return;
    }
    await this.openChat();
    await this.send({ content, contextMode });
  }

  async runReadOnlyWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) {
      return;
    }
    await this.runGeneration(async (abort) => {
      const collected = await this.collect(contextMode);
      const rules = await this.context.projectRules();
      const prompt = buildAnalysisPrompt({
        kind,
        request,
        context: collected.files,
        ...(rules.length === 0 ? {} : { rules }),
      });
      const result = await this.chat.send(
        {
          content: prompt,
          context: [],
          ...currentModelSelection(this.configuration.read(), this.state.snapshot.models),
        },
        (event) => {
          void this.view?.postEvent(event);
        },
        abort.signal,
        (threadId) => {
          this.activeThreadId = threadId;
        },
      );
      await this.view?.postResult(result);
    });
  }

  async runEditWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) {
      return;
    }
    await this.runGeneration(async (abort) => {
      const collected = await this.collect(contextMode);
      const rules = await this.context.projectRules();
      const planOnly = this.sessionControls.isPlanMode();
      if (!planOnly && !(await this.sessionControls.authorize('editGeneration'))) {
        return;
      }
      const promptBuilder = planOnly ? buildAnalysisPrompt : buildWorkflowPrompt;
      const prompt = promptBuilder({
        kind: planOnly ? 'plan' : kind,
        request,
        context: collected.files,
        ...(rules.length === 0 ? {} : { rules }),
      });
      const result = await this.chat.send(
        {
          content: prompt,
          context: [],
          ...currentModelSelection(this.configuration.read(), this.state.snapshot.models),
        },
        (event) => {
          void this.view?.postEvent(event);
        },
        abort.signal,
        (threadId) => {
          this.activeThreadId = threadId;
        },
      );
      if (planOnly) {
        await this.view?.postResult(result);
        return;
      }
      const plan = parseWorkflowEditPlan(result.content);
      const applied = await this.safeEdits.previewAndApply(plan);
      await this.view?.postResult({
        content: applied.applied
          ? vscode.l10n.t('Applied: {0}', plan.summary)
          : vscode.l10n.t('Rejected: {0}', plan.summary),
        editPlan: plan,
      });
      if (applied.applied) {
        const undo = vscode.l10n.t('Undo ClawAI changes');
        const choice = await vscode.window.showInformationMessage(
          vscode.l10n.t('ClawAI applied {0} file changes.', plan.files.length),
          undo,
        );
        if (choice === undo) {
          await this.undoLastEdit();
        }
      }
    });
  }

  async selectModel(modelKey?: string): Promise<void> {
    const selection = modelKey ?? (await pickModelKey(this.state.snapshot.models));
    if (selection === null) {
      return;
    }
    if (selection === 'AUTO') {
      await this.configuration.selectAuto();
    } else {
      if (!this.state.snapshot.models.some((model) => model.key === selection)) {
        throw new Error(vscode.l10n.t('The selected model is not available.'));
      }
      await this.configuration.selectManual(selection);
    }
    const configuration = this.configuration.read();
    this.state.update({
      routingMode: configuration.routingMode,
      selectedModel: configuration.selectedModel,
    });
  }

  async refreshModels(): Promise<void> {
    await this.runOperation(async () => {
      await this.refreshData();
    });
  }

  async initializeWorkspace(): Promise<void> {
    await this.initializer.promptAndInitialize();
  }

  async undoLastEdit(): Promise<void> {
    const undo = vscode.l10n.t('Undo changes');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Undo the most recent ClawAI edit from this extension session?'),
      { modal: true },
      undo,
    );
    if (choice === undo && (await this.editAdapter.undoLast())) {
      await vscode.window.showInformationMessage(vscode.l10n.t('ClawAI changes were undone.'));
    }
  }

  async cancel(): Promise<void> {
    this.activeAbort?.abort();
    if (this.activeThreadId !== null) {
      await this.backend.cancelStream(this.activeThreadId);
    }
    this.activeAbort = null;
    this.activeThreadId = null;
    this.state.update({ busy: false });
  }

  private async collect(mode: ContextMode): Promise<CollectedContext> {
    const configuration = this.configuration.read();
    this.refreshWorkspaceReadiness();
    const resolvedMode = this.context.resolve(mode);
    if (
      resolvedMode === 'workspace' &&
      !(await this.sessionControls.authorize('workspaceContext'))
    ) {
      throw new Error(vscode.l10n.t('Workspace context access was not approved.'));
    }
    const result = await this.context.collect(resolvedMode, configuration);
    this.state.update({ contextReceipt: result.receipt });
    return result;
  }

  private async refreshData(): Promise<void> {
    const configuration = this.configuration.read();
    const [models, usage, history] = await Promise.all([
      this.modelService.refresh(),
      this.backend.getUsage(),
      this.backend.listThreads(configuration.historyLimit),
    ]);
    const selectedExists = models.catalog.some(
      (model) => model.key === configuration.selectedModel,
    );
    if (configuration.routingMode === 'MANUAL_MODEL' && !selectedExists) {
      await this.configuration.selectAuto();
    }
    const current = this.configuration.read();
    this.state.update({
      backendStatus: 'connected',
      connected: true,
      entitlements: models.entitlements,
      history,
      modelWarnings: models.warnings,
      models: models.catalog,
      routingMode: current.routingMode,
      selectedModel: current.selectedModel,
      usage,
    });
  }

  private async runGeneration(action: (abort: AbortController) => Promise<void>): Promise<void> {
    await this.runOperation(async () => {
      if (!this.state.snapshot.connected) {
        throw new Error(vscode.l10n.t('Connect to ClawAI before sending a request.'));
      }
      await this.openChat();
      const abort = new AbortController();
      this.activeAbort = abort;
      try {
        await action(abort);
        const usage = await this.backend.getUsage();
        this.state.update({ usage });
      } finally {
        this.activeAbort = null;
        this.activeThreadId = null;
      }
    });
  }

  private async runOperation(action: () => Promise<void>): Promise<void> {
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
      await this.view?.postError(message);
      await vscode.window.showErrorMessage(message);
    } finally {
      this.state.update({ busy: false });
    }
  }

  private createBackend(configuration: RuntimeConfiguration): BackendClient {
    return new BackendClient({
      backendUrl: configuration.backendUrl,
      timeoutMs: configuration.requestTimeoutMs,
      sessionVault: this.sessionVault,
    });
  }

  private replaceBackendPorts(): void {
    this.browserAuthorization.setBackend(this.backend);
    this.chat.setBackend(this.backend);
    this.modelService.setBackend(this.backend);
  }
}
