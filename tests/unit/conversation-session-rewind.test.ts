import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { ConversationSessionService } from '../../src/services/conversation-session-service';

function harness() {
  const backend = { listMessages: vi.fn(async () => [{ id: 'm1' }]) };
  const view = {
    bindRequest: vi.fn(),
    postHistory: vi.fn(async () => undefined),
    reveal: vi.fn(async () => 'session-1'),
    titleSessionFromPrompt: vi.fn(async () => undefined),
    updateSession: vi.fn(async () => undefined),
  };
  const service = new ConversationSessionService(
    { snapshot: { history: [] } } as never,
    () => backend as never,
    () => view as never,
  );
  return { backend, service, view };
}

describe('ConversationSessionService rewind support', () => {
  it('reloads every panel showing the rewound thread, and only those', async () => {
    const { backend, service, view } = harness();
    service.attachThread('session-1', 'thread-1');
    service.attachThread('session-2', 'thread-1');
    service.attachThread('session-3', 'thread-2');

    await service.reloadThread('thread-1');

    expect(backend.listMessages).toHaveBeenCalledTimes(2);
    expect(view.postHistory).toHaveBeenCalledWith('session-1', [{ id: 'm1' }]);
    expect(view.postHistory).toHaveBeenCalledWith('session-2', [{ id: 'm1' }]);
    expect(view.postHistory).toHaveBeenCalledTimes(2);
  });

  it('reports a thread busy while a request writes into it, and free after', async () => {
    const { service } = harness();
    service.attachThread('session-1', 'thread-1');
    expect(service.isThreadBusy('thread-1')).toBe(false);

    await service.prepare('session-1', 'request-1', 'go');
    expect(service.isThreadBusy('thread-1')).toBe(true);
    expect(service.isThreadBusy('thread-2')).toBe(false);

    service.forgetRequest('request-1');
    expect(service.isThreadBusy('thread-1')).toBe(false);
  });

  it('counts a request targeted at a thread by id as busy', async () => {
    const { service } = harness();

    await service.prepare('session-9', 'request-1', 'go', { threadId: 'thread-7' });

    expect(service.isThreadBusy('thread-7')).toBe(true);
  });
});
