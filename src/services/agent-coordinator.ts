import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { BackendSessionChangedError, type BackendClient } from '../backend/backend-client';
import { AccountEpoch } from '../core/account-epoch';
import { ApprovalBroker } from '../core/approval-broker';
import { totalAttachmentBytes } from '../core/chat-attachment';
import { contextModeForCommand } from '../core/command-context';
import { type ContextMode } from '../core/context-mode';
import { cancelRunBoundary, transitionRunBoundary } from '../core/run-boundary';
import { type OutputLogger } from '../infrastructure/output-logger';
import { type VscodeWorkspaceEditAdapter } from '../infrastructure/vscode-workspace-edit-adapter';
import { type DiffPreviewProvider } from '../views/diff-preview-provider';
import { type ChatViewProvider } from '../webview/chat-view-provider';

import { AgentConnectionService } from './agent-connection-service';
import {
  pickCompareInput,
  pickModelKey,
  promptQuestion,
  promptWorkflowRequest,
} from './agent-coordinator-prompts';
import {
  applyModelSelection,
  cancelRemoteGeneration,
  createBackendClient,
  prepareGeneration,
  resetAccountScopedState,
} from './agent-coordinator-runtime';
import {
  type ChatPromptInput,
  type CompareInput,
  type RequestAdmission,
} from './agent-coordinator.types';
import { refreshAgentData, refreshConversationData } from './agent-data-service';
import { AgentExecutionPresenter } from './agent-execution-presenter';
import { AgentRunService } from './agent-run-service';
import { AgentWorkflowService } from './agent-workflow-service';
import { AttachmentRequestService } from './attachment-request-service';
import { BrowserAuthorizationService } from './browser-authorization-service';
import { ChatParticipantService } from './chat-participant-service';
import { ChatService } from './chat-service';
import { ClawaiInitializer } from './clawai-initializer';
import { ConfigurationService } from './configuration-service';
import { ConversationSessionService } from './conversation-session-service';
import { GenerationScheduler } from './generation-scheduler';
import { ModelService } from './model-service';
import { PromptExecutionService } from './prompt-execution-service';
import { RequestAdmissionService } from './request-admission-service';
import { confirmSafeEdits } from './safe-edit-confirmation';
import { SafeEditService } from './safe-edit-service';
import { SessionControlService } from './session-control-service';
import { type WorkflowKind } from './workflow-service';

import type { RuntimeConfiguration } from './configuration-service';
import type { SessionControlPort } from './session-control.types';
import type { WorkspaceContextService } from './workspace-context-service';
import type { ChatAttachment } from '../core/chat-attachment';
import type { CollectedContext } from '../core/context-collector';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { WorkspaceApprovalMemory } from '../core/workspace-approval-memory';

export class AgentCoordinator implements vscode.Disposable {
  readonly browserAuthorization: BrowserAuthorizationService;
  readonly chatParticipant: ChatParticipantService;
  readonly sessionControls: SessionControlService;
  private backend: BackendClient;
  private readonly accountEpoch = new AccountEpoch();
  private readonly runEpoch = new AccountEpoch();
  private readonly approvals: ApprovalBroker;
  private readonly admissions: RequestAdmissionService;
  private readonly connection: AgentConnectionService;
  private readonly agentWorkflows: AgentWorkflowService;
  private readonly chat: ChatService;
  private readonly configuration = new ConfigurationService();
  private readonly initializer = new ClawaiInitializer();
  private readonly modelService: ModelService;
  private readonly attachmentRequests: AttachmentRequestService;
  private readonly promptExecutions: PromptExecutionService;
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
    this.backend = createBackendClient(this.configuration.read(), this.sessionVault);
    this.attachmentRequests = new AttachmentRequestService(
      () => this.backend,
      () => this.view,
    );
    this.approvals = new ApprovalBroker(this.state);
    this.generations = new GenerationScheduler({
      after: async (signal) => {
        if (!this.state.snapshot.connected) {
          return;
        }
        const settings = this.configuration.read();
        await refreshConversationData(
          this.backend,
          settings.historyLimit,
          this.state,
          this.accountEpoch,
          signal,
        );
      },
      before: () => prepareGeneration(this.state),
      dropped: (requestId) => {
        this.view?.dropRequest(requestId);
      },
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
    this.chat = new ChatService(this.backend, (contextReceipt) => {
      this.state.update({ contextReceipt });
    });
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
      (configuration) => createBackendClient(configuration, this.sessionVault),
      (configuration) => {
        this.backend = createBackendClient(configuration, this.sessionVault);
      },
      () =>
        refreshAgentData(
          this.backend,
          this.configuration,
          this.modelService,
          this.state,
          this.accountEpoch,
        ),
      () => this.view,
      () => this.handleAccountBoundary(),
    );
    this.sessionControls = new SessionControlService(
      this.state,
      this.configuration,
      this.approvals,
      approvalMemory,
    );
    this.admissions = new RequestAdmissionService(
      this.runEpoch,
      this.context,
      this.sessionControls,
    );
    this.promptExecutions = new PromptExecutionService({
      activateThread: (threadId, requestId) => {
        this.activeThreadId = threadId;
        this.conversations.recordThread(requestId, threadId);
      },
      assertAdmission: (admission) => {
        this.admissions.assert(admission);
      },
      attachments: this.attachmentRequests,
      backend: () => this.backend,
      captureAdmission: (threadId) => this.captureAdmission(threadId),
      chat: this.chat,
      collect: (mode, configuration, session, signal) =>
        this.collect(mode, configuration, session, signal),
      configuration: this.configuration,
      conversations: this.conversations,
      generations: this.generations,
      projectRules: () => this.context.projectRules(),
      state: this.state,
      view: () => this.view,
    });
    this.chatParticipant = new ChatParticipantService(
      this.state,
      this.logger,
      this.configuration,
      this.context,
      this.chat,
      this.admissions,
      () => this.handleAccountBoundary(),
    );
    this.safeEdits = new SafeEditService(this.editAdapter, (previews, summary, session) =>
      confirmSafeEdits(this.diffPreview, session ?? this.sessionControls, previews, summary),
    );
    const agentExecutions = new AgentExecutionPresenter(
      new AgentRunService(this.context, this.sessionControls, this.chat, this.safeEdits),
      this.state,
      () => this.view,
      (threadId, requestId) => {
        this.activeThreadId = threadId;
        this.conversations.recordThread(requestId, threadId);
      },
    );
    this.agentWorkflows = new AgentWorkflowService({
      assertAdmission: (admission) => {
        this.admissions.assert(admission);
      },
      attachments: this.attachmentRequests,
      captureAdmission: (threadId) => this.captureAdmission(threadId),
      configuration: this.configuration,
      conversations: this.conversations,
      executions: agentExecutions,
      state: this.state,
    });
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

  async selectWorkspaceFolder(folderKey: string): Promise<void> {
    await this.handleWorkspaceBoundary(() => {
      this.context.selectWorkspaceFolder(folderKey);
      this.refreshWorkspaceReadiness();
    });
  }

  async workspaceFoldersChanged(): Promise<void> {
    await this.handleWorkspaceBoundary(() => {
      this.refreshWorkspaceReadiness();
    });
  }

  async connect(backendUrl: string): Promise<void> {
    await this.connection.connect(backendUrl);
  }

  dispose(): void {
    this.approvals.dispose();
    this.generations.dispose();
    this.browserAuthorization.dispose();
  }

  async logout(): Promise<void> {
    await this.handleAccountBoundary();
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

  async send(input: ChatPromptInput): Promise<void> {
    await this.promptExecutions.send(input);
  }

  async runAgent(input: {
    admission?: RequestAdmission;
    attachments?: ChatAttachment[];
    content: string;
    contextMode: ContextMode;
    modelKey?: string;
    requestId?: string;
    sessionId?: string;
  }): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    const queuedInput = await this.agentWorkflows.snapshot({
      ...input,
      kind: 'generate',
    });
    await this.agentWorkflows.prepare(queuedInput, requestId);
    await this.generations.enqueue(
      requestId,
      'agent',
      input.content,
      (signal) => this.agentWorkflows.execute(queuedInput, signal, requestId),
      totalAttachmentBytes(input.attachments),
    );
  }

  async compare(input: CompareInput): Promise<void> {
    await this.promptExecutions.compare(input);
  }

  async compareModels(judgeEnabled = false): Promise<void> {
    const input = await pickCompareInput(this.state.snapshot.models, judgeEnabled);
    if (input === null) {
      return;
    }
    const admission = this.captureAdmission();
    const sessionId = await this.openChat();
    await this.compare({
      admission,
      content: input.content,
      contextMode: contextModeForCommand(
        judgeEnabled ? 'clawAI.judgeResponses' : 'clawAI.compareModels',
      ),
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
    const admission = this.captureAdmission();
    const sessionId = await this.openChat();
    await this.send({
      admission,
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
    await this.promptExecutions.runReadOnly(kind, contextMode, request);
  }

  async runEditWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    const request = await promptWorkflowRequest(kind);
    if (request === null) {
      return;
    }
    const requestId = randomUUID();
    const queuedInput = await this.agentWorkflows.snapshot({
      content: request,
      contextMode,
      kind,
    });
    await this.agentWorkflows.prepare(queuedInput, requestId);
    await this.generations.enqueue(requestId, 'agent', request, (signal) =>
      this.agentWorkflows.execute(queuedInput, signal, requestId),
    );
  }

  async selectModel(modelKey?: string): Promise<void> {
    await applyModelSelection(modelKey, this.state, this.configuration, () =>
      pickModelKey(this.state.snapshot.models),
    );
  }

  async refreshModels(): Promise<void> {
    await this.connection.refresh();
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
    if (await this.connection.cancelConnection()) {
      return;
    }
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

  captureAdmission(threadId?: string): RequestAdmission {
    this.assertConnected();
    return this.admissions.capture(threadId);
  }

  private async collect(
    mode: ContextMode,
    configuration: RuntimeConfiguration = this.configuration.read(),
    session: SessionControlPort = this.sessionControls,
    signal?: AbortSignal,
  ): Promise<CollectedContext> {
    signal?.throwIfAborted();
    this.refreshWorkspaceReadiness();
    const resolvedMode = this.context.resolve(mode);
    if (resolvedMode === 'workspace' && !(await session.authorize('workspaceContext'))) {
      throw new Error(vscode.l10n.t('Workspace context access was not approved.'));
    }
    signal?.throwIfAborted();
    const result = await this.context.collect(resolvedMode, configuration);
    signal?.throwIfAborted();
    this.state.update({ contextReceipt: result.receipt });
    return result;
  }

  private async generationFailed(error: unknown, requestId: string): Promise<void> {
    const activeThreadId = this.activeThreadId;
    this.activeThreadId = null;
    await cancelRemoteGeneration(this.backend, this.logger, activeThreadId);
    if (error instanceof BackendSessionChangedError) {
      await this.handleAccountBoundary();
    }
    const message =
      error instanceof Error ? error.message : vscode.l10n.t('ClawAI operation failed.');
    this.logger.error('ClawAI generation failed.', error);
    this.state.update({
      backendStatus:
        error instanceof BackendSessionChangedError
          ? 'disconnected'
          : this.state.snapshot.connected
            ? 'connected'
            : 'error',
      lastError: message,
    });
    await this.view?.postError(message, requestId);
  }

  private async handleAccountBoundary(): Promise<void> {
    const backend = this.backend;
    const activeThreadId = this.activeThreadId;
    this.runEpoch.invalidate();
    this.accountEpoch.invalidate();
    cancelRunBoundary(this.generations, this.approvals);
    this.attachmentRequests.resetAccountState();
    this.conversations.resetAccountState();
    this.activeThreadId = null;
    resetAccountScopedState(this.state);
    await cancelRemoteGeneration(backend, this.logger, activeThreadId);
  }

  private handleWorkspaceBoundary(transition: () => void): Promise<void> {
    this.runEpoch.invalidate();
    const activeThreadId = this.activeThreadId;
    this.activeThreadId = null;
    return transitionRunBoundary(this.generations, this.approvals, transition, () =>
      cancelRemoteGeneration(this.backend, this.logger, activeThreadId),
    );
  }

  private assertConnected(): void {
    if (!this.state.snapshot.connected) {
      throw new Error(vscode.l10n.t('Connect to ClawAI before sending a request.'));
    }
  }
}
