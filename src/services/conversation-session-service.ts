import * as vscode from 'vscode';

import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

interface PendingThread {
  ownerRequestId: string;
  promise: Promise<string | undefined>;
  resolve(threadId: string | undefined): void;
}

export interface ConversationRequestTarget {
  threadId: string | undefined;
}

export class ConversationSessionService {
  private readonly pendingThreads = new Map<string, PendingThread>();
  private readonly requestSessions = new Map<string, string>();
  private readonly requestThreadTargets = new Map<
    string,
    Promise<string | undefined> | string | undefined
  >();
  private readonly requestLoadEpochs = new Map<string, number>();
  private readonly sessionLoadEpochs = new Map<string, number>();
  private readonly sessionThreads = new Map<string, string>();
  private accountEpoch = 0;

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
    const accountEpoch = this.accountEpoch;
    const loadEpoch = (this.sessionLoadEpochs.get(sessionId) ?? 0) + 1;
    this.sessionLoadEpochs.set(sessionId, loadEpoch);
    this.sessionThreads.set(sessionId, threadId);
    const messages = await this.backend().listMessages(threadId, 100);
    if (accountEpoch !== this.accountEpoch || this.sessionLoadEpochs.get(sessionId) !== loadEpoch) {
      return;
    }
    await this.view()?.postHistory(sessionId, messages);
  }

  async prepare(
    requestedSessionId: string | undefined,
    requestId: string,
    prompt: string,
    target?: ConversationRequestTarget,
  ): Promise<string> {
    const sessionId = requestedSessionId ?? (await this.view()?.reveal());
    if (sessionId === undefined) {
      throw new Error(vscode.l10n.t('ClawAI could not open a conversation.'));
    }
    this.requestSessions.set(requestId, sessionId);
    const currentSessionThread = this.sessionThreads.get(sessionId);
    this.requestLoadEpochs.set(
      requestId,
      target === undefined || target.threadId === currentSessionThread
        ? (this.sessionLoadEpochs.get(sessionId) ?? 0)
        : -1,
    );
    const currentThread = target === undefined ? currentSessionThread : target.threadId;
    if (currentThread !== undefined) {
      this.requestThreadTargets.set(requestId, currentThread);
    } else {
      let pending = this.pendingThreads.get(sessionId);
      if (pending === undefined) {
        let resolveThread: ((threadId: string | undefined) => void) | undefined;
        const promise = new Promise<string | undefined>((resolve) => {
          resolveThread = resolve;
        });
        pending = {
          ownerRequestId: requestId,
          promise,
          resolve: (threadId) => {
            resolveThread?.(threadId);
          },
        };
        this.pendingThreads.set(sessionId, pending);
        this.requestThreadTargets.set(requestId, undefined);
      } else {
        this.requestThreadTargets.set(requestId, pending.promise);
      }
    }
    this.view()?.bindRequest(requestId, sessionId);
    await this.view()?.titleSessionFromPrompt(sessionId, prompt);
    return sessionId;
  }

  recordThread(requestId: string, threadId: string): void {
    const sessionId = this.requestSessions.get(requestId);
    if (sessionId === undefined) {
      return;
    }
    this.requestThreadTargets.set(requestId, threadId);
    const pending = this.pendingThreads.get(sessionId);
    if (pending?.ownerRequestId === requestId) {
      pending.resolve(threadId);
      this.pendingThreads.delete(sessionId);
    }
    if (this.requestLoadEpochs.get(requestId) === (this.sessionLoadEpochs.get(sessionId) ?? 0)) {
      this.sessionThreads.set(sessionId, threadId);
      void this.view()?.updateSession(sessionId, { threadId });
    }
  }

  attachThread(sessionId: string, threadId: string): void {
    this.sessionThreads.set(sessionId, threadId);
    void this.view()?.updateSession(sessionId, { threadId });
  }

  threadFor(sessionId: string | undefined): string | undefined {
    return sessionId === undefined ? undefined : this.sessionThreads.get(sessionId);
  }

  async threadForRequest(requestId: string): Promise<string | undefined> {
    return this.requestThreadTargets.get(requestId);
  }

  forgetRequest(requestId: string): void {
    const sessionId = this.requestSessions.get(requestId);
    if (sessionId !== undefined) {
      const pending = this.pendingThreads.get(sessionId);
      if (pending?.ownerRequestId === requestId) {
        pending.resolve(undefined);
        this.pendingThreads.delete(sessionId);
      }
    }
    this.requestSessions.delete(requestId);
    this.requestLoadEpochs.delete(requestId);
    this.requestThreadTargets.delete(requestId);
  }

  resetAccountState(): void {
    this.accountEpoch += 1;
    const view = this.view();
    for (const requestId of this.requestSessions.keys()) {
      view?.releaseRequest(requestId);
    }
    for (const pending of this.pendingThreads.values()) {
      pending.resolve(undefined);
    }
    this.pendingThreads.clear();
    this.requestSessions.clear();
    this.requestLoadEpochs.clear();
    this.requestThreadTargets.clear();
    this.sessionLoadEpochs.clear();
    this.sessionThreads.clear();
    view?.resetAccountState();
  }
}
