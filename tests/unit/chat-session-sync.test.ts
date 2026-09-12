import { describe, expect, it, vi } from 'vitest';

import { ChatSessionRegistry } from '../../src/webview/chat-session-registry';
import { markSessionRead, syncSessions } from '../../src/webview/chat-session-sync';

import type { ChatSessionDescriptor } from '../../src/core/chat-session';
import type { ExtensionSnapshot } from '../../src/core/extension-state';

interface FakePanel {
  active: boolean;
  title: string;
  dispose(): void;
  webview: { postMessage(message: unknown): Promise<boolean> };
}

function panel(active = false): FakePanel {
  return {
    active,
    title: '',
    dispose: vi.fn(),
    webview: { postMessage: vi.fn(async () => true) },
  };
}

function descriptor(sessionId: string, overrides: Partial<ChatSessionDescriptor> = {}) {
  return {
    activity: 'idle' as const,
    createdAt: 1,
    sessionId,
    subject: 'Fix the parser',
    threadId: undefined,
    unread: false,
    updatedAt: 1,
    ...overrides,
  };
}

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    agentRuns: {},
    approvalRequest: undefined,
    questionRequest: undefined,
    history: [],
    ...overrides,
  } as ExtensionSnapshot;
}

function registryWith(target: FakePanel, overrides: Partial<ChatSessionDescriptor> = {}) {
  const sessions = new ChatSessionRegistry<FakePanel>();
  sessions.add(descriptor('session-1', overrides), target);
  return sessions;
}

describe('syncSessions', () => {
  it('marks a running session in its tab title', () => {
    const target = panel();
    const sessions = registryWith(target);
    sessions.bindRequest('request-1', 'session-1');

    syncSessions(
      sessions,
      snapshot({ agentRuns: { 'request-1': { phase: 'generating', files: [] } } }),
    );

    expect(target.title).not.toBe('Fix the parser');
    expect(target.title).toContain('Fix the parser');
  });

  it('marks a session unread when its run finished while the user was elsewhere', () => {
    const target = panel(false);
    const sessions = registryWith(target, { activity: 'running' });
    sessions.bindRequest('request-1', 'session-1');

    syncSessions(
      sessions,
      snapshot({ agentRuns: { 'request-1': { phase: 'applied', files: [] } } }),
    );

    expect(sessions.get('session-1')?.descriptor.unread).toBe(true);
  });

  it('never marks the session the user is looking at', () => {
    const target = panel(true);
    const sessions = registryWith(target, { activity: 'running' });
    sessions.bindRequest('request-1', 'session-1');

    syncSessions(
      sessions,
      snapshot({ agentRuns: { 'request-1': { phase: 'applied', files: [] } } }),
    );

    expect(sessions.get('session-1')?.descriptor.unread).toBe(false);
  });

  it('ignores a run that belongs to another session', () => {
    const target = panel();
    const sessions = registryWith(target);

    syncSessions(
      sessions,
      snapshot({ agentRuns: { 'request-other': { phase: 'generating', files: [] } } }),
    );

    expect(sessions.get('session-1')?.descriptor.activity).toBe('idle');
  });

  it('adopts the backend thread title once the thread has one', () => {
    const target = panel();
    const sessions = registryWith(target, { threadId: 'thread-1' });

    syncSessions(
      sessions,
      snapshot({ history: [{ id: 'thread-1', title: 'Parser rewrite' }] as never }),
    );

    expect(sessions.get('session-1')?.descriptor.subject).toBe('Parser rewrite');
  });

  it('posts nothing when nothing about the session changed', () => {
    const target = panel();
    const sessions = registryWith(target);

    syncSessions(sessions, snapshot());

    expect(target.webview.postMessage).not.toHaveBeenCalled();
  });
});

describe('markSessionRead', () => {
  it('clears the unread mark and the marker in the title', () => {
    const target = panel(true);
    const sessions = registryWith(target, { unread: true });

    markSessionRead(sessions, 'session-1');

    expect(sessions.get('session-1')?.descriptor.unread).toBe(false);
    expect(target.title).toBe('Fix the parser');
  });

  it('does nothing for a session that was already read', () => {
    const target = panel(true);
    const sessions = registryWith(target);

    markSessionRead(sessions, 'session-1');

    expect(target.webview.postMessage).not.toHaveBeenCalled();
  });

  it('does nothing for a session that is gone', () => {
    const sessions = new ChatSessionRegistry<FakePanel>();

    expect(() => {
      markSessionRead(sessions, 'missing');
    }).not.toThrow();
  });
});
