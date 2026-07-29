import type { ChatSessionDescriptor } from '../core/chat-session';

export interface ChatSessionTarget {
  dispose(): void;
}

export interface RegisteredChatSession<TTarget extends ChatSessionTarget = ChatSessionTarget> {
  descriptor: ChatSessionDescriptor;
  target: TTarget;
}

type SessionUpdate = Partial<Pick<ChatSessionDescriptor, 'subject' | 'threadId' | 'updatedAt'>>;

export class ChatSessionRegistry<TTarget extends ChatSessionTarget = ChatSessionTarget> {
  private readonly requests = new Map<string, string>();
  private readonly sessions = new Map<string, RegisteredChatSession<TTarget>>();

  add(descriptor: ChatSessionDescriptor, target: TTarget): void {
    this.sessions.set(descriptor.sessionId, {
      descriptor,
      target,
    });
  }

  bindRequest(requestId: string, sessionId: string): boolean {
    if (this.requests.has(requestId)) {
      return false;
    }
    if (!this.sessions.has(sessionId)) {
      return false;
    }
    this.requests.set(requestId, sessionId);
    return true;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.target.dispose();
    }
    this.requests.clear();
    this.sessions.clear();
  }

  get(sessionId: string): RegisteredChatSession<TTarget> | undefined {
    return this.sessions.get(sessionId);
  }

  list(): RegisteredChatSession<TTarget>[] {
    return [...this.sessions.values()];
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    for (const [requestId, owner] of this.requests) {
      if (owner === sessionId) {
        this.requests.delete(requestId);
      }
    }
  }

  requestOwner(requestId: string): RegisteredChatSession<TTarget> | undefined {
    const sessionId = this.requests.get(requestId);
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }

  releaseRequest(requestId: string): void {
    this.requests.delete(requestId);
  }

  resetAccountState(subject: string, updatedAt: number): RegisteredChatSession<TTarget>[] {
    this.requests.clear();
    for (const session of this.sessions.values()) {
      session.descriptor = {
        ...session.descriptor,
        subject,
        threadId: undefined,
        updatedAt,
      };
    }
    return this.list();
  }

  update(sessionId: string, patch: SessionUpdate): RegisteredChatSession<TTarget> | undefined {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return undefined;
    }
    session.descriptor = {
      ...session.descriptor,
      ...patch,
    };
    return session;
  }
}
