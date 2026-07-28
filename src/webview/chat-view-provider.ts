import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';
import { z } from 'zod';

import { renderChatMarkup } from './chat-markup';
import { toPublicChatState } from './chat-public-state';

import type { AgentMode } from '../core/agent-mode.types';
import type { ContextMode } from '../core/context-mode';
import type { ExtensionState } from '../core/extension-state';
import type { PermissionMode } from '../core/permission-policy.types';

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
  z.object({ type: z.literal('openFolder') }),
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

export interface ChatViewActions {
  agent(input: { content: string; contextMode: ContextMode; requestId: string }): Promise<void>;
  cancel(): Promise<void>;
  compare(input: {
    content: string;
    contextMode: ContextMode;
    modelKeys: string[];
    judgeEnabled: boolean;
    requestId: string;
  }): Promise<void>;
  connect(): Promise<void>;
  logout(): Promise<void>;
  openFolder(): Promise<void>;
  removeQueued(requestId: string): Promise<void>;
  resolveApproval(requestId: string, approved: boolean): Promise<void>;
  selectAgentMode(mode: AgentMode): Promise<void>;
  selectModel(modelKey: string): Promise<void>;
  selectPermissionMode(mode: PermissionMode): Promise<boolean>;
  selectWorkspaceFolder(folderKey: string): Promise<void>;
  send(input: { content: string; contextMode: ContextMode; requestId: string }): Promise<void>;
  undo(): Promise<void>;
}

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private panel: vscode.WebviewPanel | null = null;
  private view: vscode.WebviewView | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly state: ExtensionState,
    private readonly actions: ChatViewActions,
  ) {
    this.unsubscribe = state.subscribe((snapshot) => {
      void this.post({
        type: 'state',
        state: toPublicChatState(snapshot),
      });
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.configureWebview(view.webview);
    view.onDidDispose(() => {
      this.view = null;
    });
    void this.postState();
  }

  async reveal(): Promise<void> {
    if (this.panel !== null) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'clawAI.chatEditor',
      vscode.l10n.t('ClawAI Coding Agent'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: this.localResourceRoots(),
        retainContextWhenHidden: true,
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png');
    this.configureWebview(panel.webview);
    panel.onDidDispose(() => {
      this.panel = null;
    });
    await this.postState();
  }

  async postEvent(event: Record<string, unknown>, requestId?: string): Promise<void> {
    await this.post({
      type: 'streamEvent',
      event,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  async postResult(result: unknown, requestId?: string): Promise<void> {
    await this.post({
      type: 'result',
      result,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  async postError(message: string, requestId?: string): Promise<void> {
    await this.post({
      type: 'error',
      message,
      ...(requestId === undefined ? {} : { requestId }),
    });
  }

  async postNotice(message: string): Promise<void> {
    await this.post({ type: 'notice', message });
  }

  dispose(): void {
    this.unsubscribe();
    this.panel?.dispose();
    this.panel = null;
    this.view = null;
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = inboundMessageSchema.safeParse(message);
    if (!parsed.success) {
      await this.postError(vscode.l10n.t('The ClawAI view sent an invalid request.'));
      return;
    }
    try {
      const request = parsed.data;
      if (request.type === 'ready') {
        await this.postState();
      } else if (
        request.type === 'agent' ||
        request.type === 'compare' ||
        request.type === 'send'
      ) {
        await this.handlePromptMessage(request);
      } else {
        await this.handleControlMessage(request);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      await this.postError(message);
    }
  }

  private async handleControlMessage(request: ControlMessage): Promise<void> {
    if (request.type === 'connect') {
      await this.actions.connect();
    } else if (request.type === 'logout') {
      await this.actions.logout();
    } else if (request.type === 'cancel') {
      await this.actions.cancel();
    } else if (request.type === 'undo') {
      await this.actions.undo();
    } else if (request.type === 'openFolder') {
      await this.actions.openFolder();
    } else if (request.type === 'removeQueued') {
      await this.actions.removeQueued(request.requestId);
    } else if (request.type === 'resolveApproval') {
      await this.actions.resolveApproval(request.requestId, request.approved);
    } else if (request.type === 'selectModel') {
      await this.actions.selectModel(request.modelKey);
    } else if (request.type === 'selectAgentMode') {
      await this.actions.selectAgentMode(request.mode);
    } else if (request.type === 'selectPermissionMode') {
      await this.actions.selectPermissionMode(request.mode);
      await this.postState();
    } else {
      await this.actions.selectWorkspaceFolder(request.folderKey);
    }
  }

  private async handlePromptMessage(request: PromptMessage): Promise<void> {
    if (request.type === 'compare') {
      await this.actions.compare(request);
    } else if (request.type === 'agent') {
      await this.actions.agent(request);
    } else {
      await this.actions.send(request);
    }
  }

  private async post(message: unknown): Promise<void> {
    await Promise.all([
      this.view?.webview.postMessage(message),
      this.panel?.webview.postMessage(message),
    ]);
  }

  private async postState(): Promise<void> {
    await this.post({
      type: 'state',
      state: toPublicChatState(this.state.snapshot),
    });
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: this.localResourceRoots(),
    };
    webview.html = this.html(webview);
    webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
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
    return renderChatMarkup({
      cspSource: webview.cspSource,
      language: vscode.env.language,
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
