import * as vscode from 'vscode';

import extensionPackage from '../package.json';

import { contextModeForCommand } from './core/command-context';
import { ExtensionState } from './core/extension-state';
import { ExternalOutputGrantStore } from './core/external-output-grants';
import { createRuntimeSnapshot } from './core/runtime/runtime-event-reducer';
import { SessionVault } from './core/session-vault';
import { WorkspaceApprovalMemory } from './core/workspace-approval-memory';
import { openAgentTerminal } from './infrastructure/agent-terminal';
import { OutputLogger } from './infrastructure/output-logger';
import { VscodeContextRangeReader } from './infrastructure/vscode-context-range-reader';
import { VscodeMentionIndex } from './infrastructure/vscode-mention-index';
import { probeRuntimeHost } from './infrastructure/vscode-runtime-host-probe';
import { buildRuntimeCapabilityManifest } from './infrastructure/vscode-runtime-target-adapter';
import { VscodeTerminalTracker } from './infrastructure/vscode-terminal-capture';
import { VscodeUserNotifier } from './infrastructure/vscode-user-notifier';
import { VscodeWorkspaceEditAdapter } from './infrastructure/vscode-workspace-edit-adapter';
import { AgentCoordinator } from './services/agent-coordinator';
import { attachTerminalOutput } from './services/attach-terminal-command';
import { ConfigurationService } from './services/configuration-service';
import { ContextFreshnessTracker } from './services/context-freshness-tracker';
import { ClawaiUriHandler } from './services/deep-link-handler';
import { ExternalOutputGrantService } from './services/external-output-grant-service';
import { GlobalContextService } from './services/global-context-service';
import { groupConversation } from './services/group-conversation-command';
import { MentionSuggestionService } from './services/mention-suggestion-service';
import {
  HANDOFF_KEY,
  claimPendingWindowHandoff,
  openConversationInNewWindow,
} from './services/open-in-new-window-command';
import { ThreadGroupStore } from './services/thread-group-store';
import { WorkspaceContextService } from './services/workspace-context-service';
import { WorkspaceScopeService } from './services/workspace-scope-service';
import { workspaceSkillCatalog } from './services/workspace-skill-catalog';
import { AttentionView } from './views/attention-view';
import { createClawIconPath } from './views/claw-icon-path';
import { DiffPreviewProvider } from './views/diff-preview-provider';
import { NotificationController } from './views/notification-controller';
import { watchSetupCompletion } from './views/setup-context-key';
import { StateTreeProvider } from './views/state-tree-provider';
import { StatusBarController } from './views/status-bar-controller';
import { ChatViewProvider } from './webview/chat-view-provider';

import type { CapabilityManifest } from './core/runtime/capability-manifest';
import type { WindowHandoff } from './core/window-handoff.types';
import type { NewWindowDependencies } from './services/open-in-new-window.types';

function registerCommands(
  context: vscode.ExtensionContext,
  coordinator: AgentCoordinator,
  logger: OutputLogger,
  globalContext: GlobalContextService,
): void {
  const commands: [string, (...arguments_: unknown[]) => unknown][] = [
    ['clawAI.connect', () => coordinator.openChat()],
    ['clawAI.logout', () => coordinator.logout()],
    [
      'clawAI.openChat',
      (threadId?: unknown) =>
        coordinator.openChat(typeof threadId === 'string' ? threadId : undefined),
    ],
    ['clawAI.askSelection', () => coordinator.ask(contextModeForCommand('clawAI.askSelection'))],
    ['clawAI.askFile', () => coordinator.ask(contextModeForCommand('clawAI.askFile'))],
    ['clawAI.askWorkspace', () => coordinator.ask(contextModeForCommand('clawAI.askWorkspace'))],
    ['clawAI.compareModels', () => coordinator.compareModels(false)],
    ['clawAI.judgeResponses', () => coordinator.compareModels(true)],
    [
      'clawAI.generateCode',
      () => coordinator.runEditWorkflow('generate', contextModeForCommand('clawAI.generateCode')),
    ],
    [
      'clawAI.fixCode',
      () => coordinator.runEditWorkflow('fix', contextModeForCommand('clawAI.fixCode')),
    ],
    [
      'clawAI.reviewCode',
      () => coordinator.runReadOnlyWorkflow('review', contextModeForCommand('clawAI.reviewCode')),
    ],
    [
      'clawAI.generateTests',
      () => coordinator.runEditWorkflow('tests', contextModeForCommand('clawAI.generateTests')),
    ],
    [
      'clawAI.generatePlan',
      () => coordinator.runReadOnlyWorkflow('plan', contextModeForCommand('clawAI.generatePlan')),
    ],
    [
      'clawAI.generateDocs',
      () => coordinator.runEditWorkflow('docs', contextModeForCommand('clawAI.generateDocs')),
    ],
    [
      'clawAI.auditWorkspace',
      () =>
        coordinator.runReadOnlyWorkflow('audit', contextModeForCommand('clawAI.auditWorkspace')),
    ],
    ['clawAI.initializeWorkspace', () => coordinator.commands.initializeWorkspace()],
    ['clawAI.openGlobalRules', () => globalContext.open('rules')],
    ['clawAI.openGlobalSkills', () => globalContext.open('skills')],
    ['clawAI.refreshModels', () => coordinator.commands.refreshModels()],
    [
      'clawAI.selectModel',
      (modelKey?: unknown) =>
        coordinator.commands.selectModel(typeof modelKey === 'string' ? modelKey : undefined),
    ],
    ['clawAI.cancel', () => coordinator.cancel()],
    ['clawAI.undoLastEdit', () => coordinator.commands.undoLastEdit()],
    ['clawAI.exportTranscript', () => coordinator.commands.exportTranscript()],
    ['clawAI.showSessionRecap', () => coordinator.commands.showSessionRecap()],
    ['clawAI.sendFeedback', () => coordinator.commands.sendFeedback()],
    ['clawAI.searchRunHistory', () => coordinator.commands.searchRunHistory()],
    ['clawAI.showUsage', () => coordinator.commands.showUsage()],
    ['clawAI.createCheckpoint', () => coordinator.commands.createCheckpoint()],
    ['clawAI.restoreCheckpoint', () => coordinator.commands.restoreCheckpoint()],
    ['clawAI.askSideQuestion', () => coordinator.commands.askSideQuestion()],
    ['clawAI.compactConversation', () => coordinator.commands.compactConversation()],
    ['clawAI.selectOutputStyle', () => coordinator.commands.selectOutputStyle()],
    ['clawAI.toggleFocusView', () => coordinator.commands.toggleFocusView()],
    ['clawAI.renameChat', () => coordinator.commands.renameChat()],
    ['clawAI.archiveChat', () => coordinator.commands.archiveChat()],
    ['clawAI.browseArchivedChats', () => coordinator.commands.browseArchivedChats()],
    [
      'clawAI.showLogs',
      () => {
        logger.show();
      },
    ],
  ];

  context.subscriptions.push(
    ...commands.map(([command, callback]) => vscode.commands.registerCommand(command, callback)),
  );
}

function registerChatParticipant(
  context: vscode.ExtensionContext,
  coordinator: AgentCoordinator,
): void {
  const participant = vscode.chat.createChatParticipant(
    'clawai.coding-agent',
    async (request, _chatContext, response, token) => {
      await coordinator.chatParticipant.send(request.prompt, response, token);
    },
  );
  participant.iconPath = createClawIconPath(context.extensionUri);
  context.subscriptions.push(participant);
}

export function activate(context: vscode.ExtensionContext): void {
  const connectionConfiguration = new ConfigurationService();
  const configuration = connectionConfiguration.read();
  const workspaceScope = new WorkspaceScopeService();
  const buildManifest = (): CapabilityManifest =>
    buildRuntimeCapabilityManifest(probeRuntimeHost(context, extensionPackage.version), {
      generatedAt: new Date().toISOString(),
      manifestId: `manifest:${Date.now().toString(36)}`,
    });
  const runtimeManifest = buildManifest();
  const state = new ExtensionState({
    agentRun: undefined,
    agentRuns: {},
    agentMode: configuration.agentMode,
    viewDensity: configuration.viewDensity,
    approvalRequest: undefined,
    questionRequest: undefined,
    findings: [],
    tasks: [],
    artifacts: [],
    organizationPolicy: undefined,
    backendCustomUrl: configuration.backendCustomUrl,
    backendEnvironment: configuration.backendEnvironment,
    backendUrl: configuration.backendUrl,
    backendStatus: 'loading',
    busy: false,
    connected: false,
    frontendCustomUrl: configuration.frontendCustomUrl,
    frontendEnvironment: configuration.frontendEnvironment,
    frontendUrl: configuration.frontendUrl,
    contextReceipt: undefined,
    generationQueue: {
      active: [],
      capacity: 2,
      pending: [],
    },
    workspaceReadiness: undefined,
    entitlements: undefined,
    history: [],
    lastError: undefined,
    modelWarnings: [],
    models: [],
    effortMode: configuration.effortMode,
    speedMode: configuration.speedMode,
    permissionMode: configuration.permissionMode,
    routingMode: configuration.routingMode,
    runtime: createRuntimeSnapshot(runtimeManifest),
    selectedModel: configuration.selectedModel,
    usage: undefined,
    user: undefined,
    workspaceScope: workspaceScope.snapshot(),
  });
  const logger = new OutputLogger(vscode.window.createOutputChannel('ClawAI'));
  const externalOutputStore = new ExternalOutputGrantStore(context.workspaceState);
  const externalOutputGrants = new ExternalOutputGrantService(externalOutputStore);
  const editAdapter = new VscodeWorkspaceEditAdapter(workspaceScope, externalOutputStore);
  const diffPreview = new DiffPreviewProvider();
  const sessionVault = new SessionVault(context.secrets);
  const approvalMemory = new WorkspaceApprovalMemory(
    context.globalState,
    () => workspaceScope.snapshot().selectedFolderKey,
  );
  const globalContext = new GlobalContextService(context.globalStorageUri);
  const workspaceContext = new WorkspaceContextService(globalContext, workspaceScope);
  const coordinator = new AgentCoordinator(
    state,
    sessionVault,
    logger,
    editAdapter,
    diffPreview,
    workspaceContext,
    approvalMemory,
    externalOutputStore,
    context,
    workspaceScope,
  );
  const mentions = new MentionSuggestionService(
    new VscodeMentionIndex(),
    workspaceSkillCatalog(context.globalStorageUri, workspaceScope),
  );
  const chatView = new ChatViewProvider(context.extensionUri, state, {
    agent: (input) => coordinator.runAgent(input),
    cancel: (requestId) => coordinator.cancel(requestId),
    conversationTokens: (threadId, tokens) => coordinator.conversationTokens(threadId, tokens),
    captureAdmission: (threadId) => coordinator.captureAdmission(threadId),
    compare: (input) => coordinator.compare(input),
    configureConnections: async (profile) => {
      await connectionConfiguration.saveConnectionProfile(profile);
      await coordinator.configurationChanged();
    },
    connect: async (profile) => {
      const updated = await connectionConfiguration.saveConnectionProfile(profile);
      await coordinator.configurationChanged();
      await coordinator.connect(updated.backendUrl);
    },
    configureLanguage: async () => {
      await vscode.commands.executeCommand('workbench.action.configureLocale');
    },
    logout: () => coordinator.logout(),
    mentionSuggestions: (text, caretIndex) => mentions.suggest(text, caretIndex),
    manageExternalOutputFolders: () => externalOutputGrants.manage(),
    openThread: (input) => coordinator.openThread(input),
    openFolder: async () => {
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
    },
    refreshModels: () => coordinator.commands.refreshModels(),
    reviewChanges: async (previewId) => {
      const available = await diffPreview.show(previewId);
      if (!available) {
        await chatView.postNotice(vscode.l10n.t('No ClawAI file changes are ready to review.'));
      }
    },
    removeQueued: (requestId) => {
      coordinator.removeQueued(requestId);
      return Promise.resolve();
    },
    resolveApproval: (requestId, approved) => {
      coordinator.interruptions.resolveApproval(requestId, approved);
      return Promise.resolve();
    },
    answerQuestion: (requestId, selection) => {
      coordinator.interruptions.answerQuestion(requestId, selection);
    },
    runtimePause: () => coordinator.runtimeControl('pause'),
    runtimeResume: () => coordinator.runtimeControl('resume'),
    runtimeSteer: (message) => coordinator.runtimeSteer(message),
    runtimeStop: () => coordinator.cancel(),
    undo: () => coordinator.commands.undoLastEdit(),
    selectAgentMode: (mode) => coordinator.sessionControls.selectAgentMode(mode),
    selectViewDensity: (density) => coordinator.sessionControls.selectViewDensity(density),
    selectEffortMode: (mode) => coordinator.sessionControls.selectEffortMode(mode),
    selectSpeedMode: (mode) => coordinator.sessionControls.selectSpeedMode(mode),
    selectModel: (modelKey) => coordinator.commands.selectModel(modelKey),
    selectPermissionMode: (mode) => coordinator.sessionControls.selectPermissionMode(mode),
    selectWorkspaceFolder: (folderKey) => coordinator.selectWorkspaceFolder(folderKey),
    send: (input) => coordinator.send(input),
  });
  coordinator.attachView(chatView);

  const setupTree = new StateTreeProvider('setup', state);
  const modelTree = new StateTreeProvider('model', state);
  // Declared before the tree so the tree can read it, and given the tree's
  // refresh afterwards, because each needs the other and only one can be first.
  let refreshContextTree = (): void => undefined;
  const contextFreshness = new ContextFreshnessTracker(
    state,
    new VscodeContextRangeReader(workspaceScope),
    () => {
      refreshContextTree();
    },
  );
  const contextTree = new StateTreeProvider('context', state, undefined, (key) =>
    contextFreshness.freshness(key),
  );
  refreshContextTree = () => {
    contextTree.refresh();
  };
  const threadGroups = new ThreadGroupStore(context.workspaceState);
  const terminals = new VscodeTerminalTracker();
  const historyTree = new StateTreeProvider('history', state, () => threadGroups.read());
  const findingsTree = new StateTreeProvider('findings', state);
  const tasksTree = new StateTreeProvider('tasks', state);
  const artifactsTree = new StateTreeProvider('artifacts', state);
  const attentionTree = new StateTreeProvider('attention', state);
  const statusBar = new StatusBarController(state);
  const setupVisibility = watchSetupCompletion(state);
  const newWindowParts: NewWindowDependencies = {
    activeThreadId: () => chatView.activeThreadId(),
    workspaceFolder: () => vscode.workspace.workspaceFolders?.[0]?.uri,
    readHandoff: () => context.globalState.get<WindowHandoff>(HANDOFF_KEY),
    storeHandoff: async (handoff) => {
      await context.globalState.update(HANDOFF_KEY, handoff);
    },
    openFolderInNewWindow: async (folder) => {
      await vscode.commands.executeCommand('vscode.openFolder', folder, {
        forceNewWindow: true,
      });
    },
    openThread: (threadId) => coordinator.openChat(threadId).then(() => undefined),
    now: Date.now,
  };
  void claimPendingWindowHandoff(newWindowParts);
  const notifications = new NotificationController(state, new VscodeUserNotifier());

  context.subscriptions.push(
    notifications,
    coordinator,
    logger,
    diffPreview,
    chatView,
    setupVisibility,
    setupTree,
    modelTree,
    contextTree,
    historyTree,
    statusBar,
    vscode.window.registerWebviewViewProvider('clawAI.chat', chatView, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    // Navigation only. See docs/adr/0001-uri-handler-navigation-only.md.
    vscode.window.registerUriHandler(
      new ClawaiUriHandler({ openChat: (threadId) => coordinator.openChat(threadId) }),
    ),
    vscode.window.registerTreeDataProvider('clawAI.setup', setupTree),
    vscode.window.registerTreeDataProvider('clawAI.model', modelTree),
    vscode.window.registerTreeDataProvider('clawAI.context', contextTree),
    vscode.workspace.onDidSaveTextDocument((document) => {
      // A save is the only moment the answer can change, and the moment a
      // person is looking, so the mark appears while they still remember the
      // edit that caused it.
      void contextFreshness.fileSaved(vscode.workspace.asRelativePath(document.uri, false));
    }),
    vscode.window.registerTreeDataProvider('clawAI.history', historyTree),
    vscode.window.registerTreeDataProvider('clawAI.tasks', tasksTree),
    tasksTree,
    vscode.window.registerTreeDataProvider('clawAI.findings', findingsTree),
    artifactsTree,
    vscode.window.registerTreeDataProvider('clawAI.artifacts', artifactsTree),
    attentionTree,
    new AttentionView('clawAI.attention', attentionTree, state),
    findingsTree,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('clawAI')) {
        void coordinator.configurationChanged();
      }
    }),
    // Trust and the folder set are the two facts the capability manifest is
    // built from, so both have to rebuild it. Without this the manifest keeps
    // the values it had at activation: a window that activated untrusted goes
    // on advertising a target with no local capabilities even after the user
    // grants trust, and every tool call fails with a capability error that
    // names no cause.
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      state.setCapabilityManifest(buildManifest());
      void coordinator.trustChanged();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      state.setCapabilityManifest(buildManifest());
      void coordinator.workspaceFoldersChanged();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      coordinator.refreshWorkspaceReadiness();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      coordinator.refreshWorkspaceReadiness();
    }),
  );
  context.subscriptions.push(
    terminals,
    vscode.commands.registerCommand('clawAI.attachTerminalOutput', () =>
      attachTerminalOutput({
        terminals: () => vscode.window.terminals,
        capture: (terminal) => terminals.capture(terminal),
        insert: (block) => chatView.appendToComposer(block),
      }),
    ),
    vscode.commands.registerCommand('clawAI.groupConversation', () =>
      groupConversation({
        threads: () => state.snapshot.history,
        assignments: () => threadGroups.read(),
        save: async (assignments) => {
          await threadGroups.write(assignments);
          historyTree.refresh();
        },
      }),
    ),
    vscode.commands.registerCommand('clawAI.openConversationInNewWindow', () =>
      openConversationInNewWindow(newWindowParts),
    ),
    vscode.commands.registerCommand('clawAI.openTerminal', () =>
      openAgentTerminal(
        {
          runAgent: (input) => coordinator.runAgent(input),
          cancel: (requestId) => coordinator.cancel(requestId),
        },
        {
          subscribe: (listener) =>
            state.subscribe((snapshot) => {
              listener(snapshot.agentRuns);
            }),
          currentRuns: () => state.snapshot.agentRuns,
        },
      ),
    ),
    vscode.commands.registerCommand('clawAI.reopenClosedChat', async () => {
      const sessionId = await chatView.reopenClosedSession();
      if (sessionId === undefined) {
        await vscode.window.showInformationMessage(
          vscode.l10n.t('No recently closed ClawAI chat to reopen.'),
        );
      }
    }),
  );
  registerCommands(context, coordinator, logger, globalContext);
  registerChatParticipant(context, coordinator);
  void coordinator.initialize();
}

export function deactivate(): void {
  // All resources are owned by ExtensionContext subscriptions.
}
