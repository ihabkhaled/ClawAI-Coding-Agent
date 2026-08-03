import { randomBytes, randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import {
  createChatSession,
  DEFAULT_CHAT_SUBJECT,
  deriveConversationSubject,
} from '../core/chat-session';

import { publicHistoryMessage } from './chat-history-message';
import {
  inboundMessageSchema,
  promptRequestId,
  type ControlMessage,
  type InboundMessage,
  type PromptMessage,
} from './chat-inbound-message';
import { renderChatMarkup } from './chat-markup';
import { toPublicChatState } from './chat-public-state';
import { ChatSessionRegistry } from './chat-session-registry';
import { runPromptAdmissionFlow } from './prompt-admission-flow';

import type { ChatViewActions } from './chat-view-actions';
import type { ChatMessage } from '../backend/contracts';
import type { ExtensionState } from '../core/extension-state';

const SIDEBAR_SESSION_ID = 'sidebar';

class RequestBindingError extends Error {}

function isPromptMessage(request: InboundMessage): request is PromptMessage {
  return request.type === 'agent' || request.type === 'compare' || request.type === 'send';
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly sessions = new ChatSessionRegistry<vscode.WebviewPanel>();
  private view: vscode.WebviewView | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: ExtensionState,
    private readonly actions: ChatViewActions,
  ) {
    this.unsubscribe = state.subscribe((snapshot) => {
      this.syncSessionTitles(snapshot.history);
      void this.broadcast({
        type: 'state',
        state: toPublicChatState(snapshot),
      });
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.configureWebview(view.webview, SIDEBAR_SESSION_ID);
    view.onDidDispose(() => {
      this.view = null;
    });
    void this.postStateTo(view.webview);
  }

  async reveal(): Promise<string> {
    return this.createEditorSession();
  }

  async revealThread(threadId: string, title: string): Promise<string> {
    const sessionId = await this.createEditorSession(title, threadId);
    await this.actions.openThread({ sessionId, threadId });
    return sessionId;
  }

  bindRequest(requestId: string, sessionId: string): boolean {
    return this.sessions.bindRequest(requestId, sessionId);
  }

  releaseRequest(requestId: string): void {
    this.sessions.releaseRequest(requestId);
  }

  dropRequest(requestId: string): void {
    const owner = this.sessions.requestOwner(requestId);
    if (owner !== undefined) {
      void owner.target.webview.postMessage({ type: 'requestDropped', requestId });
    }
  }

  resetAccountState(): void {
    const sessions = this.sessions.resetAccountState(DEFAULT_CHAT_SUBJECT, Date.now());
    for (const session of sessions) {
      session.target.title = DEFAULT_CHAT_SUBJECT;
      void session.target.webview.postMessage({
        type: 'session',
        session: session.descriptor,
      });
    }
    void this.broadcast({ type: 'accountReset' });
  }

  async titleSessionFromPrompt(sessionId: string, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.descriptor.subject === DEFAULT_CHAT_SUBJECT) {
      await this.updateSession(sessionId, {
        subject: deriveConversationSubject(prompt),
      });
    }
  }

  async updateSession(
    sessionId: string,
    patch: { subject?: string; threadId?: string },
  ): Promise<void> {
    const session = this.sessions.update(sessionId, {
      ...patch,
      updatedAt: Date.now(),
    });
    if (session === undefined) {
      return;
    }
    session.target.title = session.descriptor.subject;
    await session.target.webview.postMessage({
      type: 'session',
      session: session.descriptor,
    });
  }

  async postHistory(sessionId: string, messages: ChatMessage[]): Promise<void> {
    await this.postToSession(sessionId, {
      type: 'historyLoaded',
      messages: messages.map(publicHistoryMessage),
    });
  }

  async postEvent(event: Record<string, unknown>, requestId?: string): Promise<void> {
    await this.postForRequest(
      {
        type: 'streamEvent',
        event,
        ...(requestId === undefined ? {} : { requestId }),
      },
      requestId,
    );
  }

  async postResult(result: unknown, requestId?: string): Promise<void> {
    await this.postForRequest(
      {
        type: 'result',
        result,
        ...(requestId === undefined ? {} : { requestId }),
      },
      requestId,
    );
  }

  async postError(message: string, requestId?: string): Promise<void> {
    await this.postForRequest(
      {
        type: 'error',
        message,
        ...(requestId === undefined ? {} : { requestId }),
      },
      requestId,
    );
  }

  async postNotice(message: string): Promise<void> {
    await this.broadcast({ type: 'notice', message });
  }

  dispose(): void {
    this.unsubscribe();
    this.sessions.dispose();
    this.view = null;
  }

  private async createEditorSession(
    title = DEFAULT_CHAT_SUBJECT,
    threadId?: string,
  ): Promise<string> {
    const sessionId = randomUUID();
    const descriptor = {
      ...createChatSession(sessionId),
      subject: title,
      threadId,
    };
    const panel = vscode.window.createWebviewPanel(
      'clawAI.chatEditor',
      title,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: this.localResourceRoots(),
        retainContextWhenHidden: true,
      },
    );
    panel.iconPath = {
      dark: vscode.Uri.joinPath(this.extensionUri, 'resources', 'claw-dark.svg'),
      light: vscode.Uri.joinPath(this.extensionUri, 'resources', 'claw-light.svg'),
    };
    this.sessions.add(descriptor, panel);
    this.configureWebview(panel.webview, sessionId);
    panel.onDidDispose(() => {
      this.sessions.remove(sessionId);
    });
    await this.postStateTo(panel.webview);
    await panel.webview.postMessage({ type: 'session', session: descriptor });
    return sessionId;
  }

  private async handleMessage(
    message: unknown,
    sourceSessionId: string,
    sourceWebview: vscode.Webview,
  ): Promise<void> {
    const parsed = inboundMessageSchema.safeParse(message);
    if (!parsed.success) {
      const requestId = promptRequestId(message);
      await sourceWebview.postMessage({
        type: 'error',
        message: vscode.l10n.t('The ClawAI view sent an invalid request.'),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return;
    }
    const request = parsed.data;
    try {
      await this.dispatchMessage(request, sourceSessionId, sourceWebview);
    } catch (error: unknown) {
      await this.handleMessageError(error, request, sourceWebview);
    }
  }

  private async dispatchMessage(
    request: InboundMessage,
    sourceSessionId: string,
    sourceWebview: vscode.Webview,
  ): Promise<void> {
    if (request.type === 'ready') {
      await this.postStateTo(sourceWebview);
      const session = this.sessions.get(sourceSessionId);
      if (session !== undefined) {
        await sourceWebview.postMessage({ type: 'session', session: session.descriptor });
      }
      return;
    }
    if (isPromptMessage(request)) {
      await this.handlePromptMessage(request, sourceSessionId);
      return;
    }
    await this.handleControlMessage(request, sourceSessionId);
  }

  private async handleMessageError(
    error: unknown,
    request: InboundMessage,
    sourceWebview: vscode.Webview,
  ): Promise<void> {
    const message =
      error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
    if (error instanceof RequestBindingError || !isPromptMessage(request)) {
      await sourceWebview.postMessage({ type: 'error', message });
      return;
    }
    const owner = this.sessions.requestOwner(request.requestId);
    await (owner?.target.webview ?? sourceWebview).postMessage({
      type: 'error',
      message,
      requestId: request.requestId,
    });
    this.releaseRequest(request.requestId);
  }

  private async handleControlMessage(
    request: ControlMessage,
    sourceSessionId: string,
  ): Promise<void> {
    if (await this.handleRuntimeControl(request)) return;
    if (await this.handleSessionControl(request)) return;
    if (request.type === 'undo') {
      await this.actions.undo();
    } else if (request.type === 'newChat') {
      await this.reveal();
    } else if (request.type === 'openFolder') {
      await this.actions.openFolder();
    } else if (request.type === 'refreshModels') {
      await this.actions.refreshModels();
    } else if (request.type === 'reviewChanges') {
      await this.actions.reviewChanges(request.previewId);
    } else if (request.type === 'selectHistory') {
      await this.selectHistory(sourceSessionId, request.threadId);
    } else if (request.type === 'removeQueued') {
      await this.actions.removeQueued(request.requestId);
    } else if (request.type === 'resolveApproval') {
      await this.actions.resolveApproval(request.requestId, request.approved);
    } else {
      await this.handleSelectionControl(request);
    }
  }

  private async handleSessionControl(request: ControlMessage): Promise<boolean> {
    if (request.type === 'connect') await this.actions.connect(request);
    else if (request.type === 'logout') await this.actions.logout();
    else if (request.type === 'cancel') await this.actions.cancel(request.requestId);
    else return false;
    return true;
  }

  private async handleRuntimeControl(request: ControlMessage): Promise<boolean> {
    if (request.type === 'runtimePause') await this.actions.runtimePause();
    else if (request.type === 'runtimeResume') await this.actions.runtimeResume();
    else if (request.type === 'runtimeStop') await this.actions.runtimeStop();
    else if (request.type === 'runtimeSteer') await this.actions.runtimeSteer(request.message);
    else return false;
    return true;
  }

  private async handleSelectionControl(request: ControlMessage): Promise<void> {
    if (request.type === 'configureLanguage') {
      await this.actions.configureLanguage();
    } else if (request.type === 'configureConnections') {
      await this.actions.configureConnections(request);
    } else if (request.type === 'manageExternalOutputFolders') {
      await this.actions.manageExternalOutputFolders();
    } else if (request.type === 'selectModel') {
      await this.actions.selectModel(request.modelKey);
    } else if (request.type === 'selectAgentMode') {
      await this.actions.selectAgentMode(request.mode);
    } else if (request.type === 'selectPermissionMode') {
      await this.actions.selectPermissionMode(request.mode);
      await this.postState();
    } else if (request.type === 'selectWorkspaceFolder') {
      await this.actions.selectWorkspaceFolder(request.folderKey);
    }
  }

  private async handlePromptMessage(
    request: PromptMessage,
    sourceSessionId: string,
  ): Promise<void> {
    const bound = await runPromptAdmissionFlow({
      bindRequest: (sessionId) => this.bindRequest(request.requestId, sessionId),
      captureAdmission: (threadId) => this.actions.captureAdmission(threadId),
      dispatch: async (admission, sessionId) => {
        if (request.type === 'compare') {
          await this.actions.compare({ ...request, admission, sessionId });
        } else if (request.type === 'agent') {
          await this.actions.agent({ ...request, admission, sessionId });
        } else {
          await this.actions.send({ ...request, admission, sessionId });
        }
      },
      resolveSession: () =>
        sourceSessionId === SIDEBAR_SESSION_ID ? this.reveal() : Promise.resolve(sourceSessionId),
      threadId: this.sessions.get(sourceSessionId)?.descriptor.threadId,
      titleSession: (sessionId) => this.titleSessionFromPrompt(sessionId, request.content),
    });
    if (!bound) {
      throw new RequestBindingError(vscode.l10n.t('The ClawAI view sent an invalid request.'));
    }
  }

  private async selectHistory(sourceSessionId: string, threadId: string): Promise<void> {
    const thread = this.state.snapshot.history.find((entry) => entry.id === threadId);
    if (thread === undefined) {
      throw new Error(vscode.l10n.t('That ClawAI conversation is no longer available.'));
    }
    const trimmedTitle = thread.title?.trim();
    const title =
      trimmedTitle === undefined || trimmedTitle.length === 0
        ? vscode.l10n.t('Untitled conversation')
        : trimmedTitle;
    if (sourceSessionId === SIDEBAR_SESSION_ID) {
      await this.revealThread(threadId, title);
      return;
    }
    await this.updateSession(sourceSessionId, {
      subject: title,
      threadId,
    });
    await this.actions.openThread({ sessionId: sourceSessionId, threadId });
  }

  private syncSessionTitles(history: ExtensionState['snapshot']['history']): void {
    for (const session of this.sessions.list()) {
      const thread = history.find((entry) => entry.id === session.descriptor.threadId);
      const title = thread?.title?.trim();
      if (title === undefined || title.length === 0 || title === session.descriptor.subject) {
        continue;
      }
      const updated = this.sessions.update(session.descriptor.sessionId, {
        subject: title,
        updatedAt: Date.now(),
      });
      if (updated !== undefined) {
        updated.target.title = title;
        void updated.target.webview.postMessage({
          type: 'session',
          session: updated.descriptor,
        });
      }
    }
  }

  private async broadcast(message: unknown): Promise<void> {
    await Promise.all([
      this.view?.webview.postMessage(message),
      ...this.sessions.list().map((session) => session.target.webview.postMessage(message)),
    ]);
  }

  private async postForRequest(message: unknown, requestId?: string): Promise<void> {
    if (requestId === undefined) {
      await this.broadcast(message);
      return;
    }
    const owner = this.sessions.requestOwner(requestId);
    await Promise.all([
      owner?.target.webview.postMessage(message),
      this.view?.webview.postMessage(message),
    ]);
  }

  private async postState(): Promise<void> {
    await this.broadcast({
      type: 'state',
      state: toPublicChatState(this.state.snapshot),
    });
  }

  private async postStateTo(webview: vscode.Webview): Promise<void> {
    await webview.postMessage({
      type: 'state',
      state: toPublicChatState(this.state.snapshot),
    });
  }

  private async postToSession(sessionId: string, message: unknown): Promise<void> {
    await this.sessions.get(sessionId)?.target.webview.postMessage(message);
  }

  private configureWebview(webview: vscode.Webview, sessionId: string): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: this.localResourceRoots(),
    };
    webview.html = this.html(webview);
    webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message, sessionId, webview);
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(24).toString('base64url');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'),
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png'),
    );
    return renderChatMarkup({
      cspSource: webview.cspSource,
      language: vscode.env.language,
      logoUri: logoUri.toString(),
      nonce,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      translate: (message) => vscode.l10n.t(message),
    });
  }

  private localResourceRoots(): vscode.Uri[] {
    return [
      vscode.Uri.joinPath(this.extensionUri, 'media'),
      vscode.Uri.joinPath(this.extensionUri, 'resources'),
    ];
  }
}
