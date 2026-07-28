import { randomBytes } from 'node:crypto';

import * as vscode from 'vscode';
import { z } from 'zod';

import type { ContextMode } from '../core/context-mode';
import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';

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
  z.object({
    type: z.literal('send'),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
  }),
  z.object({
    type: z.literal('compare'),
    content: z.string().min(1).max(20_000),
    contextMode: contextModeSchema,
    modelKeys: z.array(z.string()).min(2).max(5),
    judgeEnabled: z.boolean(),
  }),
  z.object({
    type: z.literal('selectModel'),
    modelKey: z.string().min(1).max(500),
  }),
]);

export interface ChatViewActions {
  cancel(): Promise<void>;
  compare(input: {
    content: string;
    contextMode: ContextMode;
    modelKeys: string[];
    judgeEnabled: boolean;
  }): Promise<void>;
  connect(): Promise<void>;
  logout(): Promise<void>;
  selectModel(modelKey: string): Promise<void>;
  send(input: { content: string; contextMode: ContextMode }): Promise<void>;
}

function publicState(snapshot: ExtensionSnapshot) {
  return {
    backendStatus: snapshot.backendStatus,
    backendUrl: snapshot.backendUrl,
    busy: snapshot.busy,
    connected: snapshot.connected,
    contextReceipt: snapshot.contextReceipt,
    workspaceReadiness: snapshot.workspaceReadiness,
    entitlements:
      snapshot.entitlements === undefined
        ? undefined
        : {
            isAdmin: snapshot.entitlements.isAdmin,
            plan: snapshot.entitlements.plan,
            quota: snapshot.entitlements.quota,
          },
    lastError: snapshot.lastError,
    modelWarnings: snapshot.modelWarnings,
    models: snapshot.models,
    routingMode: snapshot.routingMode,
    selectedModel: snapshot.selectedModel,
    usage: snapshot.usage,
    user: snapshot.user,
  };
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
        state: publicState(snapshot),
      });
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.configureWebview(view.webview);
    view.onDidDispose(() => {
      this.view = null;
    });
    void this.post({
      type: 'state',
      state: publicState(this.state.snapshot),
    });
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
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
        ],
        retainContextWhenHidden: true,
      },
    );
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'icon.png');
    this.configureWebview(panel.webview);
    panel.onDidDispose(() => {
      this.panel = null;
    });
    await this.post({
      type: 'state',
      state: publicState(this.state.snapshot),
    });
  }

  async postEvent(event: Record<string, unknown>): Promise<void> {
    await this.post({
      type: 'streamEvent',
      event,
    });
  }

  async postResult(result: unknown): Promise<void> {
    await this.post({
      type: 'result',
      result,
    });
  }

  async postError(message: string): Promise<void> {
    await this.post({
      type: 'error',
      message,
    });
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
        await this.post({
          type: 'state',
          state: publicState(this.state.snapshot),
        });
      } else if (request.type === 'connect') {
        await this.actions.connect();
      } else if (request.type === 'logout') {
        await this.actions.logout();
      } else if (request.type === 'cancel') {
        await this.actions.cancel();
      } else if (request.type === 'selectModel') {
        await this.actions.selectModel(request.modelKey);
      } else if (request.type === 'compare') {
        await this.actions.compare(request);
      } else {
        await this.actions.send(request);
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : vscode.l10n.t('ClawAI request failed.');
      await this.postError(message);
    }
  }

  private async post(message: unknown): Promise<void> {
    await Promise.all([
      this.view?.webview.postMessage(message),
      this.panel?.webview.postMessage(message),
    ]);
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
      ],
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
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!doctype html>
<html lang="${vscode.env.language}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri.toString()}" rel="stylesheet">
  <title>${vscode.l10n.t('ClawAI Coding Agent')}</title>
</head>
<body>
  <a class="skip-link" href="#composer">${vscode.l10n.t('Skip to composer')}</a>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">CLAWAI</p>
        <h1>${vscode.l10n.t('Coding Agent')}</h1>
      </div>
      <button id="sessionButton" class="quiet-button" type="button">${vscode.l10n.t('Connect')}</button>
    </header>
    <section class="route-strip" aria-label="${vscode.l10n.t('Active route')}">
      <button id="routeToggle" class="route-summary" type="button" aria-expanded="true">
        <span id="routeModel">AUTO</span>
        <span id="backendDot" class="status-dot"></span>
        <span id="backendLabel">${vscode.l10n.t('Disconnected')}</span>
      </button>
      <dl id="routeRail" class="route-rail">
        <div><dt>${vscode.l10n.t('Route')}</dt><dd id="routeMode">AUTO</dd></div>
        <div><dt>${vscode.l10n.t('Context')}</dt><dd id="contextCount">0</dd></div>
        <div><dt>${vscode.l10n.t('Tokens')}</dt><dd id="tokenCount">—</dd></div>
        <div><dt>${vscode.l10n.t('Plan')}</dt><dd id="planName">—</dd></div>
      </dl>
    </section>
    <section id="conversation" class="conversation" aria-live="polite" aria-label="${vscode.l10n.t('Conversation')}"></section>
    <section id="modelTray" class="model-tray" aria-label="${vscode.l10n.t('Compare models')}">
      <p>${vscode.l10n.t('Choose 2–5 models for compare or judge mode.')}</p>
      <div id="modelChecks" class="model-checks"></div>
    </section>
    <form id="composer" class="composer">
      <label class="sr-only" for="prompt">${vscode.l10n.t('Ask ClawAI')}</label>
      <textarea id="prompt" rows="4" maxlength="20000" placeholder="${vscode.l10n.t('Ask ClawAI about your code…')}" required></textarea>
      <div class="composer-controls">
        <label>${vscode.l10n.t('Model')}
          <select id="modelSelect" aria-label="${vscode.l10n.t('Model')}">
            <option value="AUTO">${vscode.l10n.t('Automatic routing')}</option>
          </select>
        </label>
        <label>${vscode.l10n.t('Context')}
          <select id="contextMode">
            <option value="smart">${vscode.l10n.t('Smart context')}</option>
            <option value="file">${vscode.l10n.t('Active file')}</option>
            <option value="selection">${vscode.l10n.t('Selection')}</option>
            <option value="workspace">${vscode.l10n.t('Workspace')}</option>
            <option value="none">${vscode.l10n.t('None')}</option>
          </select>
        </label>
        <label>${vscode.l10n.t('Mode')}
          <select id="runMode">
            <option value="chat">${vscode.l10n.t('Chat')}</option>
            <option value="compare">${vscode.l10n.t('Compare')}</option>
            <option value="judge">${vscode.l10n.t('Compare + Judge')}</option>
          </select>
        </label>
        <div class="actions">
          <button id="cancelButton" class="quiet-button" type="button" hidden>${vscode.l10n.t('Cancel')}</button>
          <button id="sendButton" class="primary-button" type="submit">${vscode.l10n.t('Send')}</button>
        </div>
      </div>
    </form>
    <p id="announcer" class="sr-only" aria-live="assertive"></p>
  </main>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
  }
}
