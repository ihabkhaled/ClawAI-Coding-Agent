import * as vscode from 'vscode';

import { ExtensionState } from './core/extension-state';
import { SessionVault } from './core/session-vault';
import { OutputLogger } from './infrastructure/output-logger';
import { VscodeWorkspaceEditAdapter } from './infrastructure/vscode-workspace-edit-adapter';
import { AgentCoordinator } from './services/agent-coordinator';
import { ConfigurationService } from './services/configuration-service';
import { GlobalContextService } from './services/global-context-service';
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
    ['clawAI.connect', () => coordinator.connect()],
    ['clawAI.logout', () => coordinator.logout()],
    [
      'clawAI.openChat',
      (threadId?: unknown) =>
        coordinator.openChat(typeof threadId === 'string' ? threadId : undefined),
    ],
    ['clawAI.askSelection', () => coordinator.ask('selection')],
    ['clawAI.askFile', () => coordinator.ask('file')],
    ['clawAI.askWorkspace', () => coordinator.ask('workspace')],
    ['clawAI.compareModels', () => coordinator.compareModels(false)],
    ['clawAI.judgeResponses', () => coordinator.compareModels(true)],
    ['clawAI.generateCode', () => coordinator.runEditWorkflow('generate', 'file')],
    ['clawAI.fixCode', () => coordinator.runEditWorkflow('fix', 'selection')],
    ['clawAI.reviewCode', () => coordinator.runReadOnlyWorkflow('review', 'selection')],
    ['clawAI.generateTests', () => coordinator.runEditWorkflow('tests', 'file')],
    ['clawAI.generatePlan', () => coordinator.runReadOnlyWorkflow('plan', 'workspace')],
    ['clawAI.generateDocs', () => coordinator.runEditWorkflow('docs', 'workspace')],
    ['clawAI.auditWorkspace', () => coordinator.runReadOnlyWorkflow('audit', 'workspace')],
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
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.png');
  context.subscriptions.push(participant);
}

export function activate(context: vscode.ExtensionContext): void {
  const configuration = new ConfigurationService().read();
  const state = new ExtensionState({
    backendUrl: configuration.backendUrl,
    backendStatus: 'loading',
    busy: false,
    connected: false,
    contextReceipt: undefined,
    workspaceReadiness: undefined,
    entitlements: undefined,
    history: [],
    lastError: undefined,
    models: [],
    routingMode: configuration.routingMode,
    selectedModel: configuration.selectedModel,
    usage: undefined,
    user: undefined,
  });
  const logger = new OutputLogger(vscode.window.createOutputChannel('ClawAI'));
  const editAdapter = new VscodeWorkspaceEditAdapter();
  const diffPreview = new DiffPreviewProvider();
  const sessionVault = new SessionVault(context.secrets);
  const globalContext = new GlobalContextService(context.globalStorageUri);
  const coordinator = new AgentCoordinator(
    state,
    sessionVault,
    logger,
    editAdapter,
    diffPreview,
    globalContext,
  );
  const chatView = new ChatViewProvider(context.extensionUri, state, {
    cancel: () => coordinator.cancel(),
    compare: (input) => coordinator.compare(input),
    connect: () => coordinator.connect(),
    logout: () => coordinator.logout(),
    selectModel: (modelKey) => coordinator.selectModel(modelKey),
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
    vscode.window.registerUriHandler(coordinator.browserAuthorization),
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
      coordinator.refreshWorkspaceReadiness();
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
