import { randomBytes, randomUUID } from 'node:crypto';

import * as vscode from 'vscode';
import { z } from 'zod';

import {
  createChatSession,
  DEFAULT_CHAT_SUBJECT,
  deriveConversationSubject,
} from '../core/chat-session';

import { renderChatMarkup } from './chat-markup';
import { toPublicChatState } from './chat-public-state';
import { ChatSessionRegistry } from './chat-session-registry';

import type { ChatMessage } from '../backend/contracts';
import type { AgentMode } from '../core/agent-mode.types';
import type { ContextMode } from '../core/context-mode';
import type { ExtensionState } from '../core/extension-state';
import type { PermissionMode } from '../core/permission-policy.types';

const SIDEBAR_SESSION_ID = 'sidebar';
const contextModeSchema: z.ZodType<ContextMode> = z.enum([
  'file',
  'none',
  'selection',
  'smart',
  'workspace',
]);
const inboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('connect') }),
  z.object({ type: z.literal('logout') }),
  z.object({ type: z.literal('cancel') }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('newChat') }),
  z.object({ type: z.literal('openFolder') }),
  z.object({ type: z.literal('refreshModels') }),
  z.object({
    type: z.literal('selectHistory'),
    threadId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('removeQueued'),
    requestId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('resolveApproval'),
    requestId: z.uuid(),
    approved: z.boolean(),
  }),
  z.object({
    type: z.literal('agent'),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    requestId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('send'),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    requestId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('compare'),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    modelKeys: z.array(z.string()).min(2).max(5),
    judgeEnabled: z.boolean(),
    requestId: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal('selectModel'),
    modelKey: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('selectAgentMode'),
    mode: z.enum(['AUTO', 'PLAN']),
  }),
  z.object({
    type: z.literal('selectPermissionMode'),
    mode: z.enum(['BYPASS_PERMISSIONS', 'EDIT_AUTOMATICALLY', 'MANUAL']),
  }),
  z.object({
    type: z.literal('selectWorkspaceFolder'),
    folderKey: z.string().min(1).max(100),
  }),
]);
type InboundMessage = z.infer<typeof inboundMessageSchema>;
type PromptMessage = Extract<InboundMessage, { type: 'agent' | 'compare' | 'send' }>;
type ControlMessage = Exclude<InboundMessage, PromptMessage | { type: 'ready' }>;

interface SessionInput {
  sessionId: string;
}

export interface ChatViewActions {
  agent(
    input: SessionInput & { content: string; contextMode: ContextMode; requestId: string },
  ): Promise<void>;
  cancel(): Promise<void>;
  compare(
    input: SessionInput & {
      content: string;
      contextMode: ContextMode;
      modelKeys: string[];
      judgeEnabled: boolean;
      requestId: string;
    },
  ): Promise<void>;
  connect(): Promise<void>;
  logout(): Promise<void>;
  openFolder(): Promise<void>;
  openThread(input: SessionInput & { threadId: string }): Promise<void>;
  refreshModels(): Promise<void>;
  removeQueued(requestId: string): Promise<void>;
  resolveApproval(requestId: string, approved: boolean): Promise<void>;
  selectAgentMode(mode: AgentMode): Promise<void>;
  selectModel(modelKey: string): Promise<void>;
  selectPermissionMode(mode: PermissionMode): Promise<boolean>;
  selectWorkspaceFolder(folderKey: string): Promise<void>;
  send(
    input: SessionInput & { content: string; contextMode: ContextMode; requestId: string },
  ): Promise<void>;
  undo(): Promise<void>;
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

  bindRequest(requestId: string, sessionId: string): void {
    this.sessions.bindRequest(requestId, sessionId);
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
      messages: messages.map((message) => ({
        content: message.content,
        createdAt:
          message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
        id: message.id,
        inputTokens: message.inputTokens,
        latencyMs: message.latencyMs,
        model: message.model,
        outputTokens: message.outputTokens,
        provider: message.provider,
        role: message.role,
        status: message.status,
      })),
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
      await sourceWebview.postMessage({
        type: 'error',
        message: vscode.l10n.t('The ClawAI view sent an invalid request.'),
      });
      return;
    }
    try {
      const request = parsed.data;
      if (request.type === 'ready') {
        await this.postStateTo(sourceWebview);
        const session = this.sessions.get(sourceSessionId);
        if (session !== undefined) {
          await sourceWebview.postMessage({ type: 'session', session: session.descriptor });
        }
      } else if (
        request.type === 'agent' ||
        request.type === 'compare' ||
        request.type === 'send'
      ) {
        await this.handlePromptMessage(request, sourceSessionId);
      } else {
        await this.handleControlMessage(request, sourceSessionId);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      await sourceWebview.postMessage({ type: 'error', message });
    }
  }

  private async handleControlMessage(
    request: ControlMessage,
    sourceSessionId: string,
  ): Promise<void> {
    if (request.type === 'connect') {
      await this.actions.connect();
    } else if (request.type === 'logout') {
      await this.actions.logout();
    } else if (request.type === 'cancel') {
      await this.actions.cancel();
    } else if (request.type === 'undo') {
      await this.actions.undo();
    } else if (request.type === 'newChat') {
      await this.reveal();
    } else if (request.type === 'openFolder') {
      await this.actions.openFolder();
    } else if (request.type === 'refreshModels') {
      await this.actions.refreshModels();
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

  private async handleSelectionControl(request: ControlMessage): Promise<void> {
    if (request.type === 'selectModel') {
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
    const sessionId =
      sourceSessionId === SIDEBAR_SESSION_ID ? await this.reveal() : sourceSessionId;
    this.bindRequest(request.requestId, sessionId);
    await this.titleSessionFromPrompt(sessionId, request.content);
    if (request.type === 'compare') {
      await this.actions.compare({ ...request, sessionId });
    } else if (request.type === 'agent') {
      await this.actions.agent({ ...request, sessionId });
    } else {
      await this.actions.send({ ...request, sessionId });
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
