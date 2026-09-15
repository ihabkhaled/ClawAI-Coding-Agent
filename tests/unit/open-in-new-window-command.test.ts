import { describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({ showInformationMessage: vi.fn() }));

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  window: windowMock,
}));

const { claimPendingWindowHandoff, openConversationInNewWindow } =
  await import('../../src/services/open-in-new-window-command');

import type { WindowHandoff } from '../../src/core/window-handoff.types';

const folder = { fsPath: '/workspace' } as never;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    activeThreadId: () => 'thread-1' as string | undefined,
    workspaceFolder: () => folder as unknown,
    readHandoff: () => undefined as WindowHandoff | undefined,
    storeHandoff: vi.fn(async () => undefined),
    openFolderInNewWindow: vi.fn(async () => undefined),
    openThread: vi.fn(async () => undefined),
    now: () => 1_000_000,
    ...overrides,
  };
}

describe('openConversationInNewWindow', () => {
  it('refuses when no conversation is open', async () => {
    const parts = dependencies({ activeThreadId: () => undefined });

    await openConversationInNewWindow(parts as never);

    expect(parts.openFolderInNewWindow).not.toHaveBeenCalled();
  });

  it('refuses without a folder rather than opening an empty window', async () => {
    const parts = dependencies({ workspaceFolder: () => undefined });

    await openConversationInNewWindow(parts as never);

    expect(parts.openFolderInNewWindow).not.toHaveBeenCalled();
  });

  it('leaves a note and opens the folder in a new window', async () => {
    const parts = dependencies();

    await openConversationInNewWindow(parts as never);

    expect(parts.storeHandoff).toHaveBeenCalledWith({
      threadId: 'thread-1',
      requestedAt: 1_000_000,
    });
    expect(parts.openFolderInNewWindow).toHaveBeenCalledWith(folder);
  });
});

describe('claimPendingWindowHandoff', () => {
  it('opens the conversation the previous window asked for', async () => {
    const parts = dependencies({
      readHandoff: () => ({ threadId: 'thread-9', requestedAt: 1_000_000 }),
    });

    await claimPendingWindowHandoff(parts as never);

    expect(parts.openThread).toHaveBeenCalledWith('thread-9');
  });

  it('clears the note before opening, so a failure cannot leave it behind', async () => {
    const order: string[] = [];
    const parts = dependencies({
      readHandoff: () => ({ threadId: 'thread-9', requestedAt: 1_000_000 }),
      storeHandoff: vi.fn(async () => {
        order.push('cleared');
      }),
      openThread: vi.fn(async () => {
        order.push('opened');
      }),
    });

    await claimPendingWindowHandoff(parts as never);

    expect(order).toEqual(['cleared', 'opened']);
  });

  it('ignores a stale note rather than hijacking this window', async () => {
    const parts = dependencies({ readHandoff: () => ({ threadId: 'old', requestedAt: 0 }) });

    await claimPendingWindowHandoff(parts as never);

    expect(parts.openThread).not.toHaveBeenCalled();
    expect(parts.storeHandoff).toHaveBeenCalledWith(undefined);
  });

  it('does nothing at all when there is no note', async () => {
    const parts = dependencies();

    await claimPendingWindowHandoff(parts as never);

    expect(parts.storeHandoff).not.toHaveBeenCalled();
    expect(parts.openThread).not.toHaveBeenCalled();
  });
});
