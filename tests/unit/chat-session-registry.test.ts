import { describe, expect, it, vi } from 'vitest';

import { ChatSessionRegistry } from '../../src/webview/chat-session-registry';

describe('ChatSessionRegistry', () => {
  it('keeps editor sessions independent and routes requests to their owner', () => {
    const registry = new ChatSessionRegistry();
    const firstDisposed = vi.fn();
    const secondDisposed = vi.fn();

    registry.add(
      {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'First',
        threadId: undefined,
        updatedAt: 1,
      },
      { dispose: firstDisposed },
    );
    registry.add(
      {
        createdAt: 2,
        sessionId: 'session-2',
        subject: 'Second',
        threadId: undefined,
        updatedAt: 2,
      },
      { dispose: secondDisposed },
    );
    registry.bindRequest('request-2', 'session-2');

    expect(registry.requestOwner('request-2')?.descriptor.sessionId).toBe('session-2');
    expect(registry.get('session-1')?.descriptor.subject).toBe('First');
    registry.releaseRequest('request-2');
    expect(registry.requestOwner('request-2')).toBeUndefined();

    registry.remove('session-1');
    expect(firstDisposed).not.toHaveBeenCalled();
    expect(registry.get('session-1')).toBeUndefined();
    expect(registry.get('session-2')).toBeDefined();
  });

  it('updates the subject and backend thread without replacing the panel target', () => {
    const registry = new ChatSessionRegistry();
    const target = { dispose: vi.fn() };
    registry.add(
      {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'New ClawAI chat',
        threadId: undefined,
        updatedAt: 1,
      },
      target,
    );

    registry.update('session-1', {
      subject: 'Create loop file',
      threadId: 'thread-1',
      updatedAt: 3,
    });

    expect(registry.get('session-1')).toEqual({
      descriptor: {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'Create loop file',
        threadId: 'thread-1',
        updatedAt: 3,
      },
      target,
    });
  });

  it('clears request ownership and backend thread descriptors for an account reset', () => {
    const registry = new ChatSessionRegistry();
    const target = { dispose: vi.fn() };
    registry.add(
      {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'Private thread',
        threadId: 'thread-1',
        updatedAt: 1,
      },
      target,
    );
    registry.bindRequest('request-1', 'session-1');

    const reset = registry.resetAccountState('New ClawAI chat', 5);

    expect(registry.requestOwner('request-1')).toBeUndefined();
    expect(reset).toHaveLength(1);
    expect(registry.get('session-1')?.descriptor).toMatchObject({
      subject: 'New ClawAI chat',
      threadId: undefined,
      updatedAt: 5,
    });
  });

  it('reserves request ownership atomically and rejects a second session', () => {
    const registry = new ChatSessionRegistry();
    registry.add(
      {
        createdAt: 1,
        sessionId: 'session-1',
        subject: 'First',
        threadId: undefined,
        updatedAt: 1,
      },
      { dispose: vi.fn() },
    );
    registry.add(
      {
        createdAt: 2,
        sessionId: 'session-2',
        subject: 'Second',
        threadId: undefined,
        updatedAt: 2,
      },
      { dispose: vi.fn() },
    );

    expect(registry.bindRequest('request-1', 'session-1')).toBe(true);
    expect(registry.bindRequest('request-1', 'session-1')).toBe(false);
    expect(registry.bindRequest('request-1', 'session-2')).toBe(false);
    expect(registry.requestOwner('request-1')?.descriptor.sessionId).toBe('session-1');
  });
});
