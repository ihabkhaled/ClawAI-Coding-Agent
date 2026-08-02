import * as vscode from 'vscode';

import extensionPackage from '../package.json';

import { contextModeForCommand } from './core/command-context';
import { ExtensionState } from './core/extension-state';
import { ExternalOutputGrantStore } from './core/external-output-grants';
import { createRuntimeSnapshot } from './core/runtime/runtime-event-reducer';
import { SessionVault } from './core/session-vault';
import { WorkspaceApprovalMemory } from './core/workspace-approval-memory';
import { OutputLogger } from './infrastructure/output-logger';
import { buildRuntimeCapabilityManifest } from './infrastructure/vscode-runtime-target-adapter';
import { VscodeWorkspaceEditAdapter } from './infrastructure/vscode-workspace-edit-adapter';
import { AgentCoordinator } from './services/agent-coordinator';
import { ConfigurationService } from './services/configuration-service';
import { ExternalOutputGrantService } from './services/external-output-grant-service';
import { GlobalContextService } from './services/global-context-service';
import { WorkspaceContextService } from './services/workspace-context-service';
import { WorkspaceScopeService } from './services/workspace-scope-service';
import { createClawIconPath } from './views/claw-icon-path';
import { DiffPreviewProvider } from './views/diff-preview-provider';
import { StateTreeProvider } from './views/state-tree-provider';
import { StatusBarController } from './views/status-bar-controller';
import { ChatViewProvider } from './webview/chat-view-provider';

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
    ['clawAI.initializeWorkspace', () => coordinator.initializeWorkspace()],
    ['clawAI.openGlobalRules', () => globalContext.open('rules')],
    ['clawAI.openGlobalSkills', () => globalContext.open('skills')],
    ['clawAI.refreshModels', () => coordinator.refreshModels()],
    [
      'clawAI.selectModel',
      (modelKey?: unknown) =>
        coordinator.selectModel(typeof modelKey === 'string' ? modelKey : undefined),
    ],
    ['clawAI.cancel', () => coordinator.cancel()],
    ['clawAI.undoLastEdit', () => coordinator.undoLastEdit()],
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
  const extensionKind =
    context.extension.extensionKind === vscode.ExtensionKind.UI ? 'ui' : 'workspace';
  const runtimeManifest = buildRuntimeCapabilityManifest(
    {
      architecture: process.arch,
      extensionKind,
      extensionVersion: extensionPackage.version,
      platform: process.platform,
      remoteName: vscode.env.remoteName,
      shell: vscode.env.shell,
      uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
      vscodeVersion: vscode.version,
      workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
        name: folder.name,
        scheme: folder.uri.scheme,
        uri: folder.uri.toString(),
      })),
      workspaceTrusted: vscode.workspace.isTrusted,
    },
    {
      generatedAt: new Date().toISOString(),
      manifestId: `manifest:${Date.now().toString(36)}`,
    },
  );
  const state = new ExtensionState({
    agentRun: undefined,
    agentRuns: {},
    agentMode: configuration.agentMode,
    approvalRequest: undefined,
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
  );
  const chatView = new ChatViewProvider(context.extensionUri, state, {
    agent: (input) => coordinator.runAgent(input),
    cancel: (requestId) => coordinator.cancel(requestId),
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
    manageExternalOutputFolders: () => externalOutputGrants.manage(),
    openThread: (input) => coordinator.openThread(input),
    openFolder: async () => {
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
    },
    refreshModels: () => coordinator.refreshModels(),
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
      coordinator.resolveApproval(requestId, approved);
      return Promise.resolve();
    },
    undo: () => coordinator.undoLastEdit(),
    selectAgentMode: (mode) => coordinator.sessionControls.selectAgentMode(mode),
    selectModel: (modelKey) => coordinator.selectModel(modelKey),
    selectPermissionMode: (mode) => coordinator.sessionControls.selectPermissionMode(mode),
    selectWorkspaceFolder: (folderKey) => coordinator.selectWorkspaceFolder(folderKey),
    send: (input) => coordinator.send(input),
  });
  coordinator.attachView(chatView);

  const modelTree = new StateTreeProvider('model', state);
  const contextTree = new StateTreeProvider('context', state);
  const historyTree = new StateTreeProvider('history', state);
  const statusBar = new StatusBarController(state);

  context.subscriptions.push(
    coordinator,
    logger,
    diffPreview,
    chatView,
    modelTree,
    contextTree,
    historyTree,
    statusBar,
    vscode.window.registerWebviewViewProvider('clawAI.chat', chatView, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    vscode.window.registerTreeDataProvider('clawAI.model', modelTree),
    vscode.window.registerTreeDataProvider('clawAI.context', contextTree),
    vscode.window.registerTreeDataProvider('clawAI.history', historyTree),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('clawAI')) {
        void coordinator.configurationChanged();
      }
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void coordinator.trustChanged();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void coordinator.workspaceFoldersChanged();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      coordinator.refreshWorkspaceReadiness();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      coordinator.refreshWorkspaceReadiness();
    }),
  );
  registerCommands(context, coordinator, logger, globalContext);
  registerChatParticipant(context, coordinator);
  void coordinator.initialize();
}

export function deactivate(): void {
  // All resources are owned by ExtensionContext subscriptions.
}
