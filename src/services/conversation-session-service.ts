import * as vscode from 'vscode';

import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export class ConversationSessionService {
  private readonly requestSessions = new Map<string, string>();
  private readonly sessionThreads = new Map<string, string>();

  constructor(
    private readonly state: ExtensionState,
    private readonly backend: () => BackendClient,
    private readonly view: () => ChatViewProvider | null,
  ) {}

  async openChat(threadId?: string): Promise<string | undefined> {
    if (threadId === undefined) {
      return this.view()?.reveal();
    }
    const thread = this.state.snapshot.history.find((entry) => entry.id === threadId);
    const trimmedTitle = thread?.title?.trim();
    const title =
      trimmedTitle === undefined || trimmedTitle.length === 0
        ? vscode.l10n.t('Untitled conversation')
        : trimmedTitle;
    return this.view()?.revealThread(threadId, title);
  }

  async loadThread(sessionId: string, threadId: string): Promise<void> {
    const messages = await this.backend().listMessages(threadId, 100);
    this.sessionThreads.set(sessionId, threadId);
    await this.view()?.postHistory(sessionId, messages);
  }

  async prepare(
    requestedSessionId: string | undefined,
    requestId: string,
    prompt: string,
  ): Promise<string> {
    const sessionId = requestedSessionId ?? (await this.view()?.reveal());
    if (sessionId === undefined) {
      throw new Error(vscode.l10n.t('ClawAI could not open a conversation.'));
    }
    this.requestSessions.set(requestId, sessionId);
    this.view()?.bindRequest(requestId, sessionId);
    await this.view()?.titleSessionFromPrompt(sessionId, prompt);
    return sessionId;
  }

  recordThread(requestId: string, threadId: string): void {
    const sessionId = this.requestSessions.get(requestId);
    if (sessionId === undefined) {
      return;
    }
    this.sessionThreads.set(sessionId, threadId);
    void this.view()?.updateSession(sessionId, { threadId });
  }

  attachThread(sessionId: string, threadId: string): void {
    this.sessionThreads.set(sessionId, threadId);
    void this.view()?.updateSession(sessionId, { threadId });
  }

  threadFor(sessionId: string | undefined): string | undefined {
    return sessionId === undefined ? undefined : this.sessionThreads.get(sessionId);
  }

  forgetRequest(requestId: string): void {
    this.requestSessions.delete(requestId);
  }
}
