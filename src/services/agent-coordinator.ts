import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { BackendClient } from '../backend/backend-client';
import { ApprovalBroker } from '../core/approval-broker';
import { type ContextMode } from '../core/context-mode';
import { type OutputLogger } from '../infrastructure/output-logger';
import { type VscodeWorkspaceEditAdapter } from '../infrastructure/vscode-workspace-edit-adapter';
import { type DiffPreviewProvider } from '../views/diff-preview-provider';
import { type ChatViewProvider } from '../webview/chat-view-provider';

import { AgentConnectionService } from './agent-connection-service';
import {
  contextualPrompt,
  currentModelSelection,
  formatCompareResponse,
  pickCompareInput,
  pickModelKey,
  promptQuestion,
  promptWorkflowRequest,
} from './agent-coordinator-prompts';
import { type AgentWorkflowInput, type CompareInput } from './agent-coordinator.types';
import { refreshAgentData } from './agent-data-service';
import { AgentExecutionPresenter } from './agent-execution-presenter';
import { AgentRunService } from './agent-run-service';
import { BrowserAuthorizationService } from './browser-authorization-service';
import { ChatParticipantService } from './chat-participant-service';
import { ChatService } from './chat-service';
import { ClawaiInitializer } from './clawai-initializer';
import { ConfigurationService, type RuntimeConfiguration } from './configuration-service';
import { ConversationSessionService } from './conversation-session-service';
import { GenerationScheduler } from './generation-scheduler';
import { ModelService } from './model-service';
import { confirmSafeEdits } from './safe-edit-confirmation';
import { SafeEditService } from './safe-edit-service';
import { SessionControlService } from './session-control-service';
import { buildAnalysisPrompt, type WorkflowKind } from './workflow-service';

import type { WorkspaceContextService } from './workspace-context-service';
import type { CollectedContext } from '../core/context-collector';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { WorkspaceApprovalMemory } from '../core/workspace-approval-memory';

export class AgentCoordinator implements vscode.Disposable {
  readonly browserAuthorization: BrowserAuthorizationService;
  readonly chatParticipant: ChatParticipantService;
  readonly sessionControls: SessionControlService;
  private backend: BackendClient;
  private readonly approvals: ApprovalBroker;
  private readonly connection: AgentConnectionService;
  private readonly agentExecutions: AgentExecutionPresenter;
  private readonly chat: ChatService;
  private readonly configuration = new ConfigurationService();
  private readonly initializer = new ClawaiInitializer();
  private readonly modelService: ModelService;
  private readonly safeEdits: SafeEditService;
  private readonly generations: GenerationScheduler;
  private readonly conversations: ConversationSessionService;
  private activeThreadId: string | null = null;
  private view: ChatViewProvider | null = null;

  constructor(
    readonly state: ExtensionState,
    private readonly sessionVault: SessionVault,
    private readonly logger: OutputLogger,
    private readonly editAdapter: VscodeWorkspaceEditAdapter,
    private readonly diffPreview: DiffPreviewProvider,
    private readonly context: WorkspaceContextService,
    approvalMemory: WorkspaceApprovalMemory,
  ) {
    this.backend = this.createBackend(this.configuration.read());
    this.approvals = new ApprovalBroker(this.state);
    this.generations = new GenerationScheduler({
      after: async () => {
        const settings = this.configuration.read();
        const [history, usage] = await Promise.all([
          this.backend.listThreads(settings.historyLimit),
          this.backend.getUsage(),
        ]);
        this.state.update({ history, usage });
      },
      before: () => this.prepareGeneration(),
      failed: (error, requestId) => this.generationFailed(error, requestId),
      queueChanged: (generationQueue) => {
        this.state.update({
          busy: generationQueue.active !== undefined,
          generationQueue,
        });
      },
      settled: (requestId) => {
        this.activeThreadId = null;
        this.conversations.forgetRequest(requestId);
        this.view?.releaseRequest(requestId);
      },
    });
    this.browserAuthorization = new BrowserAuthorizationService(this.backend);
    this.conversations = new ConversationSessionService(
      this.state,
      () => this.backend,
      () => this.view,
    );
    this.chat = new ChatService(this.backend);
    this.modelService = new ModelService(this.backend);
    this.connection = new AgentConnectionService(
      this.state,
      this.sessionVault,
      this.logger,
      this.configuration,
      this.browserAuthorization,
      this.chat,
      this.modelService,
      () => this.backend,
      (configuration) => {
        this.backend = this.createBackend(configuration);
      },
      () => refreshAgentData(this.backend, this.configuration, this.modelService, this.state),
      () => this.view,
    );
    this.sessionControls = new SessionControlService(
      this.state,
      this.configuration,
      this.approvals,
      approvalMemory,
    );
    this.chatParticipant = new ChatParticipantService(
      this.state,
      this.logger,
      this.configuration,
      this.context,
      this.chat,
      this.sessionControls,
    );
    this.safeEdits = new SafeEditService(this.editAdapter, (previews, summary) =>
      confirmSafeEdits(this.diffPreview, this.sessionControls, previews, summary),
    );
    this.agentExecutions = new AgentExecutionPresenter(
      new AgentRunService(this.context, this.sessionControls, this.chat, this.safeEdits),
      this.state,
      () => this.view,
      (threadId, requestId) => {
        this.activeThreadId = threadId;
        this.conversations.recordThread(requestId, threadId);
      },
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
    await this.connection.initialize();
  }

  async configurationChanged(): Promise<void> {
    await this.connection.configurationChanged();
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
    await this.connection.connect();
  }

  dispose(): void {
    this.approvals.dispose();
    this.generations.dispose();
    this.browserAuthorization.dispose();
  }

  async logout(): Promise<void> {
    await this.connection.logout();
  }

  async openChat(threadId?: string): Promise<string | undefined> {
    return this.conversations.openChat(threadId);
  }

  async openThread(input: { sessionId: string; threadId: string }): Promise<void> {
    if (!this.state.snapshot.connected) {
      return;
    }
    await this.connection.run(async () => {
      await this.conversations.loadThread(input.sessionId, input.threadId);
    });
  }

  async send(input: {
    content: string;
    contextMode: ContextMode;
    requestId?: string;
    sessionId?: string;
  }): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    const sessionId = await this.conversations.prepare(input.sessionId, requestId, input.content);
    await this.generations.enqueue(requestId, 'chat', input.content, async (signal) => {
      const collected = await this.collect(input.contextMode);
      const selection = currentModelSelection(
        this.configuration.read(),
        this.state.snapshot.models,
      );
      const threadId = this.conversations.threadFor(sessionId);
      const result = await this.chat.send(
        {
          content: this.sessionControls.preparePrompt(input.content),
          context: collected.files,
          ...selection,
          ...(threadId === undefined ? {} : { threadId }),
        },
        (event) => {
          void this.view?.postEvent(event, requestId);
        },
        signal,
        (threadId) => {
          this.activeThreadId = threadId;
          this.conversations.recordThread(requestId, threadId);
        },
      );
      await this.view?.postResult(result, requestId);
    });
  }

  async runAgent(input: {
    content: string;
    contextMode: ContextMode;
    requestId?: string;
    sessionId?: string;
  }): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    const sessionId = await this.conversations.prepare(input.sessionId, requestId, input.content);
    await this.generations.enqueue(requestId, 'agent', input.content, (signal) =>
      this.executeAgentRun({ ...input, kind: 'generate', sessionId }, signal, requestId),
    );
  }

  async compare(input: CompareInput): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    const sessionId = await this.conversations.prepare(input.sessionId, requestId, input.content);
    await this.generations.enqueue(
      requestId,
      input.judgeEnabled ? 'judge' : 'compare',
      input.content,
      async () => {
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
        this.conversations.attachThread(sessionId, response.threadId);
        await this.view?.postResult(
          {
            content: formatCompareResponse(response),
            compare: response,
          },
          requestId,
        );
      },
    );
  }

  async compareModels(judgeEnabled = false): Promise<void> {
    const input = await pickCompareInput(this.state.snapshot.models, judgeEnabled);
    if (input === null) {
      return;
    }
    const sessionId = await this.openChat();
    await this.compare({
      content: input.content,
      contextMode: 'file',
      modelKeys: input.modelKeys,
      judgeEnabled,
      requestId: randomUUID(),
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  async ask(contextMode: ContextMode): Promise<void> {
    const content = await promptQuestion();
    if (content === null) {
      return;
    }
    const sessionId = await this.openChat();
    await this.send({
      content,
      contextMode,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  async runReadOnlyWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) {
      return;
    }
    const requestId = randomUUID();
    const sessionId = await this.conversations.prepare(undefined, requestId, request);
    await this.generations.enqueue(requestId, 'chat', request, async (signal) => {
      const collected = await this.collect(contextMode);
      const rules = await this.context.projectRules();
      const prompt = buildAnalysisPrompt({
        kind,
        request,
        context: collected.files,
        ...(rules.length === 0 ? {} : { rules }),
      });
      const threadId = this.conversations.threadFor(sessionId);
      const result = await this.chat.send(
        {
          content: prompt,
          context: [],
          ...currentModelSelection(this.configuration.read(), this.state.snapshot.models),
          ...(threadId === undefined ? {} : { threadId }),
        },
        (event) => {
          void this.view?.postEvent(event, requestId);
        },
        signal,
        (threadId) => {
          this.activeThreadId = threadId;
          this.conversations.recordThread(requestId, threadId);
        },
      );
      await this.view?.postResult(result, requestId);
    });
  }

  async runEditWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) {
      return;
    }
    const requestId = randomUUID();
    const sessionId = await this.conversations.prepare(undefined, requestId, request);
    await this.generations.enqueue(requestId, 'agent', request, (signal) =>
      this.executeAgentRun({ content: request, contextMode, kind, sessionId }, signal, requestId),
    );
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
    await this.connection.run(async () => {
      await refreshAgentData(this.backend, this.configuration, this.modelService, this.state);
    });
  }

  async initializeWorkspace(): Promise<void> {
    await this.initializer.promptAndInitialize();
  }

  async undoLastEdit(): Promise<void> {
    if (await this.editAdapter.undoLast()) {
      await this.view?.postNotice(vscode.l10n.t('ClawAI changes were undone.'));
    }
  }

  async cancel(): Promise<void> {
    this.approvals.cancelCurrent();
    this.generations.cancelActive();
    if (this.activeThreadId !== null) {
      await this.backend.cancelStream(this.activeThreadId);
    }
    this.activeThreadId = null;
  }

  removeQueued = (requestId: string): void => void this.generations.remove(requestId);

  resolveApproval = (requestId: string, approved: boolean): void =>
    void this.approvals.resolve(requestId, approved);

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

  private async executeAgentRun(
    input: AgentWorkflowInput,
    signal: AbortSignal,
    requestId: string,
  ): Promise<void> {
    const threadId = this.conversations.threadFor(input.sessionId);
    await this.agentExecutions.execute(
      {
        ...input,
        configuration: this.configuration.read(),
        selection: currentModelSelection(this.configuration.read(), this.state.snapshot.models),
        ...(threadId === undefined ? {} : { threadId }),
      },
      signal,
      requestId,
    );
  }

  private prepareGeneration(): Promise<void> {
    this.state.update({
      backendStatus: this.state.snapshot.connected ? 'connected' : 'loading',
      lastError: undefined,
    });
    if (!this.state.snapshot.connected) {
      return Promise.reject(
        new Error(vscode.l10n.t('Connect to ClawAI before sending a request.')),
      );
    }
    return Promise.resolve();
  }

  private async generationFailed(error: unknown, requestId: string): Promise<void> {
    const message =
      error instanceof Error ? error.message : vscode.l10n.t('ClawAI operation failed.');
    this.logger.error('ClawAI generation failed.', error);
    this.state.update({
      backendStatus: this.state.snapshot.connected ? 'connected' : 'error',
      lastError: message,
    });
    await this.view?.postError(message, requestId);
  }

  private createBackend(configuration: RuntimeConfiguration): BackendClient {
    return new BackendClient({
      backendUrl: configuration.backendUrl,
      timeoutMs: configuration.requestTimeoutMs,
      sessionVault: this.sessionVault,
    });
  }
}
