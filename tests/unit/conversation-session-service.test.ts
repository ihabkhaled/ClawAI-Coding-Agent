import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { ConversationSessionService } from '../../src/services/conversation-session-service';

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve(value: T) {
      resolve?.(value);
    },
  };
}

function harness(options?: {
  history?: { id: string; title?: string | null }[];
  revealSessionId?: string;
  viewAvailable?: boolean;
}) {
  const messages = deferred<never[]>();
  const backend = {
    listMessages: vi.fn(() => messages.promise),
  };
  const view = {
    bindRequest: vi.fn(),
    postHistory: vi.fn(async () => undefined),
    reveal: vi.fn(async () => options?.revealSessionId),
    revealThread: vi.fn(async () => undefined),
    releaseRequest: vi.fn(),
    resetAccountState: vi.fn(),
    titleSessionFromPrompt: vi.fn(async () => undefined),
    updateSession: vi.fn(async () => undefined),
  };
  const service = new ConversationSessionService(
    { snapshot: { history: options?.history ?? [] } } as never,
    () => backend as never,
    () => (options?.viewAvailable === false ? null : (view as never)),
  );
  return { backend, messages, service, view };
}

describe('ConversationSessionService', () => {
  it('clears account-bound request and thread ownership together', async () => {
    const subject = harness();
    await subject.service.prepare('session-1', 'request-1', 'Inspect the workspace');
    subject.service.recordThread('request-1', 'thread-1');
    subject.service.attachThread('session-2', 'thread-2');

    subject.service.resetAccountState();
    subject.service.recordThread('request-1', 'stale-thread');

    expect(subject.service.threadFor('session-1')).toBeUndefined();
    expect(subject.service.threadFor('session-2')).toBeUndefined();
    expect(subject.view.releaseRequest).toHaveBeenCalledWith('request-1');
    expect(subject.view.resetAccountState).toHaveBeenCalledOnce();
    expect(subject.view.updateSession).not.toHaveBeenCalledWith('session-1', {
      threadId: 'stale-thread',
    });
  });

  it('does not restore old-account history when an in-flight load finishes after reset', async () => {
    const subject = harness();
    const loading = subject.service.loadThread('session-1', 'thread-1');

    subject.service.resetAccountState();
    subject.messages.resolve([]);
    await loading;

    expect(subject.service.threadFor('session-1')).toBeUndefined();
    expect(subject.view.postHistory).not.toHaveBeenCalled();
  });

  it('keeps the latest history selection when an older load finishes last', async () => {
    const first = deferred<never[]>();
    const second = deferred<never[]>();
    const view = {
      bindRequest: vi.fn(),
      postHistory: vi.fn(async () => undefined),
      releaseRequest: vi.fn(),
      resetAccountState: vi.fn(),
      titleSessionFromPrompt: vi.fn(async () => undefined),
      updateSession: vi.fn(async () => undefined),
    };
    const backend = {
      listMessages: vi.fn((threadId: string) =>
        threadId === 'thread-a' ? first.promise : second.promise,
      ),
    };
    const service = new ConversationSessionService(
      { snapshot: { history: [] } } as never,
      () => backend as never,
      () => view as never,
    );

    const loadingA = service.loadThread('session-1', 'thread-a');
    const loadingB = service.loadThread('session-1', 'thread-b');
    second.resolve([]);
    await loadingB;
    first.resolve([]);
    await loadingA;

    expect(service.threadFor('session-1')).toBe('thread-b');
    expect(view.postHistory).toHaveBeenCalledOnce();
    expect(view.postHistory).toHaveBeenCalledWith('session-1', []);
  });

  it('keeps an existing request on its submission thread after history selection changes', async () => {
    const subject = harness();
    subject.service.attachThread('session-1', 'thread-a');
    await subject.service.prepare('session-1', 'request-1', 'Queued question');
    const requestThread = subject.service.threadForRequest('request-1');
    const loadingB = subject.service.loadThread('session-1', 'thread-b');
    subject.messages.resolve([]);
    await loadingB;

    await expect(requestThread).resolves.toBe('thread-a');
    expect(subject.service.threadFor('session-1')).toBe('thread-b');
  });

  it('chains queued follow-ups to the first new request thread', async () => {
    const subject = harness();
    await subject.service.prepare('session-1', 'request-1', 'First question', {
      threadId: undefined,
    });
    await subject.service.prepare('session-1', 'request-2', 'Queued follow-up', {
      threadId: undefined,
    });
    const followUpThread = subject.service.threadForRequest('request-2');

    subject.service.recordThread('request-1', 'thread-created-by-first');

    await expect(followUpThread).resolves.toBe('thread-created-by-first');
  });

  it('uses the submission thread when history changes before request preparation', async () => {
    const subject = harness();
    subject.service.attachThread('session-1', 'thread-a');
    const loadingB = subject.service.loadThread('session-1', 'thread-b');
    subject.view.updateSession.mockClear();

    await subject.service.prepare('session-1', 'request-1', 'Question for thread A', {
      threadId: 'thread-a',
    });

    await expect(subject.service.threadForRequest('request-1')).resolves.toBe('thread-a');
    subject.service.recordThread('request-1', 'thread-a');
    expect(subject.service.threadFor('session-1')).toBe('thread-b');
    expect(subject.view.updateSession).not.toHaveBeenCalledWith('session-1', {
      threadId: 'thread-a',
    });

    subject.messages.resolve([]);
    await loadingB;
  });

  it('pins a request to the selected thread before deferred history loading completes', async () => {
    const first = deferred<never[]>();
    const second = deferred<never[]>();
    const view = {
      bindRequest: vi.fn(),
      postHistory: vi.fn(async () => undefined),
      releaseRequest: vi.fn(),
      resetAccountState: vi.fn(),
      titleSessionFromPrompt: vi.fn(async () => undefined),
      updateSession: vi.fn(async () => undefined),
    };
    const backend = {
      listMessages: vi.fn((threadId: string) =>
        threadId === 'thread-a' ? first.promise : second.promise,
      ),
    };
    const service = new ConversationSessionService(
      { snapshot: { history: [] } } as never,
      () => backend as never,
      () => view as never,
    );
    service.attachThread('session-1', 'thread-a');
    const staleLoad = service.loadThread('session-1', 'thread-a');
    const selectedLoad = service.loadThread('session-1', 'thread-b');

    await service.prepare('session-1', 'request-1', 'Question for the selected history');
    await expect(service.threadForRequest('request-1')).resolves.toBe('thread-b');

    first.resolve([]);
    await staleLoad;
    expect(service.threadFor('session-1')).toBe('thread-b');
    expect(view.postHistory).not.toHaveBeenCalled();

    second.resolve([]);
    await selectedLoad;
    expect(view.postHistory).toHaveBeenCalledWith('session-1', []);
  });

  it('reveals new and historical conversations with normalized titles', async () => {
    const subject = harness({
      history: [
        { id: 'thread-named', title: '  Release plan  ' },
        { id: 'thread-empty', title: '   ' },
      ],
      revealSessionId: 'session-new',
    });

    await expect(subject.service.openChat()).resolves.toBe('session-new');
    await subject.service.openChat('thread-named');
    await subject.service.openChat('thread-empty');
    await subject.service.openChat('thread-missing');

    expect(subject.view.reveal).toHaveBeenCalledOnce();
    expect(subject.view.revealThread).toHaveBeenNthCalledWith(1, 'thread-named', 'Release plan');
    expect(subject.view.revealThread).toHaveBeenNthCalledWith(
      2,
      'thread-empty',
      'Untitled conversation',
    );
    expect(subject.view.revealThread).toHaveBeenNthCalledWith(
      3,
      'thread-missing',
      'Untitled conversation',
    );
  });

  it('opens a new session through the view and binds the request lifecycle', async () => {
    const subject = harness({ revealSessionId: 'session-new' });

    await expect(
      subject.service.prepare(undefined, 'request-1', 'Name this conversation'),
    ).resolves.toBe('session-new');

    expect(subject.view.reveal).toHaveBeenCalledOnce();
    expect(subject.view.bindRequest).toHaveBeenCalledWith('request-1', 'session-new');
    expect(subject.view.titleSessionFromPrompt).toHaveBeenCalledWith(
      'session-new',
      'Name this conversation',
    );
    expect(subject.service.threadFor(undefined)).toBeUndefined();
  });

  it('rejects preparation when no chat view can create a session', async () => {
    const subject = harness({ viewAvailable: false });

    await expect(subject.service.prepare(undefined, 'request-1', 'Question')).rejects.toThrow(
      'ClawAI could not open a conversation.',
    );
    await expect(subject.service.openChat()).resolves.toBeUndefined();

    expect(subject.backend.listMessages).not.toHaveBeenCalled();
  });

  it('forgets an owning request and releases queued followers without assigning a thread', async () => {
    const subject = harness();
    await subject.service.prepare('session-1', 'request-owner', 'First question');
    await subject.service.prepare('session-1', 'request-follower', 'Follow-up');
    const followerThread = subject.service.threadForRequest('request-follower');

    subject.service.forgetRequest('request-owner');

    await expect(followerThread).resolves.toBeUndefined();
    subject.service.recordThread('request-owner', 'late-thread');
    expect(subject.service.threadFor('session-1')).toBeUndefined();

    subject.service.forgetRequest('request-follower');
    subject.service.forgetRequest('missing-request');
    await expect(subject.service.threadForRequest('request-owner')).resolves.toBeUndefined();
  });

  it('does not let a request from an older load epoch replace the selected thread', async () => {
    const subject = harness();
    await subject.service.prepare('session-1', 'request-1', 'Question');
    const loading = subject.service.loadThread('session-1', 'thread-selected');

    subject.service.recordThread('request-1', 'thread-created-late');
    subject.messages.resolve([]);
    await loading;

    expect(subject.service.threadFor('session-1')).toBe('thread-selected');
    expect(subject.view.updateSession).not.toHaveBeenCalledWith('session-1', {
      threadId: 'thread-created-late',
    });
  });

  it('updates an attached session when a follow-up request records its response thread', async () => {
    const subject = harness();
    subject.service.attachThread('session-1', 'thread-original');
    await subject.service.prepare('session-1', 'request-1', 'Follow-up');

    subject.service.recordThread('request-1', 'thread-follow-up');

    expect(subject.service.threadFor('session-1')).toBe('thread-follow-up');
    expect(subject.view.updateSession).toHaveBeenCalledWith('session-1', {
      threadId: 'thread-follow-up',
    });
  });

  it('resets pending requests even when the chat view is unavailable', async () => {
    const subject = harness({ viewAvailable: false });
    await subject.service.prepare('session-1', 'request-1', 'Question');
    const pendingThread = subject.service.threadForRequest('request-1');

    subject.service.resetAccountState();

    await expect(pendingThread).resolves.toBeUndefined();
    expect(subject.service.threadFor('session-1')).toBeUndefined();
  });
});
