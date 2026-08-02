import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { type BackendClient } from '../backend/backend-client';
import { AccountEpoch } from '../core/account-epoch';
import { ApprovalBroker } from '../core/approval-broker';
import { totalAttachmentBytes } from '../core/chat-attachment';
import { contextModeForCommand } from '../core/command-context';
import { type ContextMode } from '../core/context-mode';
import { GenerationThreadRegistry } from '../core/generation-thread-registry';
import { type ResearchMode } from '../core/research-mode';
import { type OutputLogger } from '../infrastructure/output-logger';
import { type VscodeWorkspaceEditAdapter } from '../infrastructure/vscode-workspace-edit-adapter';
import { type DiffPreviewProvider } from '../views/diff-preview-provider';
import { type ChatViewProvider } from '../webview/chat-view-provider';

import { AgentConnectionService } from './agent-connection-service';
import { collectAgentContext } from './agent-context-service';
import { AgentCoordinatorBoundaries } from './agent-coordinator-boundaries';
import { pickCompareInput, pickModelKey } from './agent-coordinator-prompts';
import {
  applyModelSelection,
  cancelRemoteGenerations,
  cancelTargetGeneration,
  createBackendClient,
  prepareGeneration,
  removeSettledAgentRun,
} from './agent-coordinator-runtime';
import { AgentCoordinatorWorkflowActions } from './agent-coordinator-workflow-actions';
import {
  type ChatPromptInput,
  type CompareInput,
  type ExternalOutputGrantStore,
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
import { GenerationScheduler, generationConcurrencyKey } from './generation-scheduler';
import { ModelService } from './model-service';
import { PromptExecutionService } from './prompt-execution-service';
import { RequestAdmissionService } from './request-admission-service';
import { RuntimeProtocolService } from './runtime-protocol-service';
import { confirmSafeEdits } from './safe-edit-confirmation';
import { SafeEditService } from './safe-edit-service';
import { SessionControlService } from './session-control-service';
import { VscodeRuntimeStudio } from './vscode-runtime-studio';
import { type WorkflowKind } from './workflow-service';

import type { WorkspaceContextService } from './workspace-context-service';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ExtensionState } from '../core/extension-state';
import type { SessionVault } from '../core/session-vault';
import type { WorkspaceApprovalMemory } from '../core/workspace-approval-memory';

export class AgentCoordinator implements vscode.Disposable {
  readonly browserAuthorization: BrowserAuthorizationService;
  readonly chatParticipant: ChatParticipantService;
  readonly sessionControls: SessionControlService;
  private backend: BackendClient;
  private readonly accountEpoch = new AccountEpoch();
  private readonly dataRefreshEpoch = new AccountEpoch();
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
  private readonly activeThreads = new GenerationThreadRegistry();
  private readonly runtimeStudio: VscodeRuntimeStudio;
  private readonly boundaries: AgentCoordinatorBoundaries;
  private readonly workflowActions: AgentCoordinatorWorkflowActions;
  private view: ChatViewProvider | null = null;

  constructor(
    readonly state: ExtensionState,
    private readonly sessionVault: SessionVault,
    private readonly logger: OutputLogger,
    private readonly editAdapter: VscodeWorkspaceEditAdapter,
    private readonly diffPreview: DiffPreviewProvider,
    private readonly context: WorkspaceContextService,
    approvalMemory: WorkspaceApprovalMemory,
    externalOutputs: ExternalOutputGrantStore,
    extensionContext: vscode.ExtensionContext,
    workspaceScope: WorkspaceScopeService,
  ) {
    this.backend = createBackendClient(this.configuration.read(), this.sessionVault);
    this.attachmentRequests = new AttachmentRequestService(
      () => this.backend,
      () => this.view,
    );
    this.approvals = new ApprovalBroker(this.state);
    this.runtimeStudio = new VscodeRuntimeStudio(
      extensionContext,
      this.state,
      this.configuration,
      workspaceScope,
      externalOutputs,
      this.approvals,
      () => this.backend,
      this.logger,
    );
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
          this.dataRefreshEpoch,
        );
      },
      before: () => prepareGeneration(this.state),
      dropped: (requestId) => {
        this.view?.dropRequest(requestId);
      },
      failed: (error, requestId) => this.boundaries.generationFailed(error, requestId),
      queueChanged: (generationQueue) => {
        this.state.update({
          busy: generationQueue.active.length > 0,
          generationQueue,
        });
      },
      settled: (requestId) => {
        this.activeThreads.forget(requestId);
        removeSettledAgentRun(this.state, requestId);
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
    this.boundaries = new AgentCoordinatorBoundaries(
      () => this.backend,
      () => this.view,
      this.state,
      this.logger,
      this.activeThreads,
      this.runEpoch,
      this.accountEpoch,
      this.runtimeStudio,
      this.generations,
      this.approvals,
      this.attachmentRequests,
      this.conversations,
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
      new RuntimeProtocolService(() => this.backend),
      () =>
        refreshAgentData(
          this.backend,
          this.configuration,
          this.modelService,
          this.state,
          this.accountEpoch,
          this.dataRefreshEpoch,
        ),
      () => this.view,
      () => this.boundaries.account(),
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
      externalOutputs,
    );
    this.promptExecutions = new PromptExecutionService({
      activateThread: (threadId, requestId) => {
        this.activeThreads.record(requestId, threadId);
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
        collectAgentContext(
          this.context,
          this.state,
          () => {
            this.refreshWorkspaceReadiness();
          },
          mode,
          configuration,
          session,
          signal,
        ),
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
      this.generations,
      (threadId, requestId) => {
        this.activeThreads.record(requestId, threadId);
      },
      (requestId) => this.cancel(requestId),
      () => this.boundaries.account(),
    );
    this.safeEdits = new SafeEditService(this.editAdapter, (previews, summary, session, signal) =>
      confirmSafeEdits(
        this.diffPreview,
        session ?? this.sessionControls,
        previews,
        summary,
        signal,
      ),
    );
    const agentExecutions = new AgentExecutionPresenter(
      new AgentRunService(this.context, this.sessionControls, this.chat, this.safeEdits),
      this.state,
      () => this.view,
      (threadId, requestId) => {
        this.activeThreads.record(requestId, threadId);
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
    this.workflowActions = new AgentCoordinatorWorkflowActions(
      () => this.captureAdmission(),
      () => this.openChat(),
      (input) => this.send(input),
      this.promptExecutions,
      this.agentWorkflows,
      this.generations,
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
    this.runtimeStudio.dispose();
  }

  async logout(): Promise<void> {
    await this.boundaries.account();
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
    researchMode?: ResearchMode;
    requestId?: string;
    sessionId?: string;
  }): Promise<void> {
    const requestId = input.requestId ?? randomUUID();
    const queuedInput = await this.agentWorkflows.snapshot({
      ...input,
      kind: 'generate',
    });
    const sessionId = await this.agentWorkflows.prepare(queuedInput, requestId);
    await this.generations.enqueue(
      requestId,
      'agent',
      input.content,
      async (signal) => {
        const requiresLegacyPayload =
          (queuedInput.attachments?.length ?? 0) > 0 ||
          (queuedInput.researchMode !== undefined && queuedInput.researchMode !== 'NONE');
        if (
          this.state.snapshot.runtime.protocolSelection.mode !== 'runtime-v2' ||
          requiresLegacyPayload
        ) {
          return this.agentWorkflows.execute(queuedInput, signal, requestId);
        }
        const threadId = await this.conversations.threadForRequest(requestId);
        if (threadId === undefined)
          throw new Error('Runtime V2 requires a persisted conversation thread');
        await this.runtimeStudio.execute({
          prompt: queuedInput.content,
          threadId,
          requestId,
          ...(queuedInput.selection.provider === undefined
            ? {}
            : { provider: queuedInput.selection.provider }),
          ...(queuedInput.selection.model === undefined
            ? {}
            : { model: queuedInput.selection.model }),
          signal,
          onEvent: (event) => {
            if (event.type === 'model.delta') {
              void this.view?.postEvent(
                { type: 'CONTENT_DELTA', delta: event.payload.text },
                requestId,
              );
            } else if (event.type === 'phase.changed') {
              void this.view?.postEvent(
                { type: 'RUNTIME_PHASE', label: event.payload.phase },
                requestId,
              );
            }
          },
        });
      },
      {
        concurrencyKey: generationConcurrencyKey(sessionId, queuedInput.admission.threadId),
        modelLabel: queuedInput.modelLabel,
        retainedBytes: totalAttachmentBytes(input.attachments),
      },
    );
  }

  compare = (input: CompareInput): Promise<void> => this.promptExecutions.compare(input);

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

  ask = (contextMode: ContextMode): Promise<void> => this.workflowActions.ask(contextMode);

  async runReadOnlyWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    await this.workflowActions.runReadOnly(kind, contextMode);
  }

  async runEditWorkflow(kind: WorkflowKind, contextMode: ContextMode): Promise<void> {
    await this.workflowActions.runEdit(kind, contextMode);
  }

  async selectModel(modelKey?: string): Promise<void> {
    await applyModelSelection(modelKey, this.state, this.configuration, () =>
      pickModelKey(this.state.snapshot.models),
    );
  }

  refreshModels = (): Promise<void> => this.connection.refresh();

  initializeWorkspace = (): Promise<void> => this.initializer.promptAndInitialize();

  async undoLastEdit(): Promise<void> {
    if (await this.safeEdits.undoLast()) {
      await this.view?.postNotice(vscode.l10n.t('ClawAI changes were undone.'));
    }
  }

  async cancel(requestId?: string): Promise<void> {
    if (requestId !== undefined) {
      return cancelTargetGeneration(
        () => this.generations.cancel(requestId),
        () => this.activeThreads.take(requestId),
        this.backend,
        this.logger,
      );
    }
    if (await this.connection.cancelConnection()) {
      return;
    }
    this.approvals.cancelCurrent();
    await this.runtimeStudio.cancel();
    this.generations.cancelAll();
    const threadIds = this.activeThreads.takeAll();
    await cancelRemoteGenerations(this.backend, this.logger, threadIds);
  }

  removeQueued = (requestId: string): void => void this.generations.remove(requestId);

  resolveApproval = (requestId: string, approved: boolean): void =>
    void this.approvals.resolve(requestId, approved);

  captureAdmission(threadId?: string): RequestAdmission {
    if (!this.state.snapshot.connected) {
      throw new Error(vscode.l10n.t('Connect to ClawAI before sending a request.'));
    }
    return this.admissions.capture(threadId);
  }

  private handleWorkspaceBoundary(transition: () => void): Promise<void> {
    return this.boundaries.workspace(transition);
  }
}
