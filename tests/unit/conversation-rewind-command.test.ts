import { beforeEach, describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
}));

vi.mock('vscode', () => ({
  l10n: { t: (message: string, ...args: string[]) => `${message}${args.join(',')}` },
  window: windowMock,
}));

const { captureConversationAnchor, chooseRestoreScope, rewindConversation } =
  await import('../../src/services/conversation-rewind-command');
const { createCheckpoint, restoreCheckpoint } =
  await import('../../src/services/checkpoint-command');

import type { Checkpoint } from '../../src/core/checkpoint.types';

const anchored: Checkpoint = {
  id: 'c1',
  label: 'before refactor',
  createdAt: 1,
  files: [{ rootKey: 'root', path: 'a.ts', content: 'x' }],
  conversation: { threadId: 'thread-1', messageId: 'm1' },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    threadForSession: vi.fn(() => 'thread-1'),
    activeThreadId: vi.fn(() => 'thread-1'),
    isThreadBusy: vi.fn(() => false),
    listMessages: vi.fn(async () => [
      { id: 'm1', role: 'USER', content: 'first', createdAt: '2026-09-29T10:00:00.000Z' },
      { id: 'm2', role: 'ASSISTANT', content: 'second', createdAt: '2026-09-29T10:00:01.000Z' },
    ]),
    rewindThread: vi.fn(async () => ({
      threadId: 'thread-1',
      afterMessageId: 'm1',
      removedCount: 1,
    })),
    reloadThread: vi.fn(async () => undefined),
    checkpoints: vi.fn((): Checkpoint[] => []),
    restoreCode: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rewindConversation', () => {
  it('rewinds the panel thread to the clicked turn after confirmation and reloads it', async () => {
    windowMock.showWarningMessage.mockResolvedValue('Rewind Conversation');
    const parts = dependencies();

    await rewindConversation(parts, { sessionId: 's1', messageId: 'm1' });

    expect(parts.threadForSession).toHaveBeenCalledWith('s1');
    expect(parts.rewindThread).toHaveBeenCalledWith('thread-1', 'm1');
    expect(parts.reloadThread).toHaveBeenCalledWith('thread-1');
    expect(parts.restoreCode).not.toHaveBeenCalled();
    expect(windowMock.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Conversation rewound.'),
    );
  });

  it('changes nothing when the confirmation is dismissed', async () => {
    windowMock.showWarningMessage.mockResolvedValue(undefined);
    const parts = dependencies();

    await rewindConversation(parts, { messageId: 'm1' });

    expect(parts.rewindThread).not.toHaveBeenCalled();
  });

  it('offers code only when a checkpoint was taken at that turn, and restores it first', async () => {
    const order: string[] = [];
    windowMock.showWarningMessage.mockResolvedValue('Rewind Conversation and Code');
    const parts = dependencies({
      checkpoints: () => [anchored],
      restoreCode: vi.fn(async () => {
        order.push('code');
      }),
      rewindThread: vi.fn(async () => {
        order.push('conversation');
        return { threadId: 'thread-1', afterMessageId: 'm1', removedCount: 1 };
      }),
    });

    await rewindConversation(parts, { messageId: 'm1' });

    expect(windowMock.showWarningMessage).toHaveBeenCalledWith(
      expect.any(String),
      { modal: true },
      'Rewind Conversation',
      'Rewind Conversation and Code',
    );
    expect(order).toEqual(['code', 'conversation']);
  });

  it('leaves the conversation alone when the code restore fails', async () => {
    windowMock.showWarningMessage.mockResolvedValue('Rewind Conversation and Code');
    const parts = dependencies({
      checkpoints: () => [anchored],
      restoreCode: vi.fn(async () => {
        throw new Error('File changed after review: a.ts');
      }),
    });

    await expect(rewindConversation(parts, { messageId: 'm1' })).rejects.toThrow('File changed');
    expect(parts.rewindThread).not.toHaveBeenCalled();
  });

  it('shows only the conversation option without a matching checkpoint', async () => {
    windowMock.showWarningMessage.mockResolvedValue(undefined);

    await rewindConversation(dependencies(), { messageId: 'm2' });

    expect(windowMock.showWarningMessage).toHaveBeenCalledWith(
      expect.any(String),
      { modal: true },
      'Rewind Conversation',
    );
  });

  it('asks which message from the palette, newest first', async () => {
    windowMock.showQuickPick.mockImplementation(async (items: { messageId: string }[]) => items[0]);
    windowMock.showWarningMessage.mockResolvedValue('Rewind Conversation');
    const parts = dependencies();

    await rewindConversation(parts);

    const items = windowMock.showQuickPick.mock.calls[0]?.[0] as {
      messageId: string;
      description: string;
    }[];
    expect(items.map((item) => item.messageId)).toEqual(['m2', 'm1']);
    expect(items.map((item) => item.description)).toEqual(['Assistant', 'You']);
    expect(parts.rewindThread).toHaveBeenCalledWith('thread-1', 'm2');
  });

  it('stops when the palette pick is dismissed', async () => {
    windowMock.showQuickPick.mockResolvedValue(undefined);
    const parts = dependencies();

    await rewindConversation(parts);

    expect(windowMock.showWarningMessage).not.toHaveBeenCalled();
  });

  it('says so when the conversation has no messages', async () => {
    const parts = dependencies({ listMessages: vi.fn(async () => []) });

    await rewindConversation(parts);

    expect(windowMock.showQuickPick).not.toHaveBeenCalled();
    expect(windowMock.showInformationMessage).toHaveBeenCalledWith(
      'This conversation has no messages to rewind to.',
    );
  });

  it('says so when no conversation is open', async () => {
    const parts = dependencies({ activeThreadId: () => undefined });

    await rewindConversation(parts);

    expect(windowMock.showInformationMessage).toHaveBeenCalledWith(
      'Open a conversation to rewind first.',
    );
    expect(parts.rewindThread).not.toHaveBeenCalled();
  });

  it('refuses while a reply is still being written into the thread', async () => {
    windowMock.showWarningMessage.mockResolvedValueOnce('Rewind Conversation');
    const parts = dependencies({ isThreadBusy: () => true });

    await rewindConversation(parts, { messageId: 'm1' });

    expect(parts.rewindThread).not.toHaveBeenCalled();
    expect(windowMock.showWarningMessage).toHaveBeenLastCalledWith(
      'Wait for the current reply to finish before rewinding.',
    );
  });
});

describe('checkpoints paired with the conversation', () => {
  it('restores code without asking for a checkpoint with no anchor', async () => {
    await expect(chooseRestoreScope({ ...anchored, conversation: undefined })).resolves.toBe(
      'code',
    );
    expect(windowMock.showQuickPick).not.toHaveBeenCalled();
  });

  it('lets an anchored checkpoint restore code, conversation, or both', async () => {
    windowMock.showQuickPick.mockImplementation(async (items: { scope: string }[]) => items[1]);

    await expect(chooseRestoreScope(anchored)).resolves.toBe('both');
  });

  it('records where the conversation stood, and nothing when it cannot be read', async () => {
    await expect(captureConversationAnchor(dependencies())).resolves.toEqual({
      threadId: 'thread-1',
      messageId: 'm2',
    });
    await expect(
      captureConversationAnchor(dependencies({ activeThreadId: () => undefined })),
    ).resolves.toBeUndefined();
    await expect(
      captureConversationAnchor(
        dependencies({ listMessages: vi.fn(async () => Promise.reject(new Error('offline'))) }),
      ),
    ).resolves.toBeUndefined();
  });

  function checkpointParts(overrides: Record<string, unknown> = {}) {
    return {
      touchedFiles: vi.fn(async () => anchored.files),
      checkpoints: vi.fn(() => [anchored]),
      save: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined),
      conversationAnchor: vi.fn(async () => ({ threadId: 'thread-1', messageId: 'm2' })),
      rewindConversation: vi.fn(async () => true),
      ...overrides,
    };
  }

  it('saves the conversation anchor with a new checkpoint', async () => {
    windowMock.showInputBox.mockResolvedValue('before refactor');
    const parts = checkpointParts();

    await createCheckpoint(parts);

    expect(parts.save).toHaveBeenCalledWith(
      expect.objectContaining({ conversation: { threadId: 'thread-1', messageId: 'm2' } }),
    );
  });

  it('saves an unanchored checkpoint when no conversation is open', async () => {
    windowMock.showInputBox.mockResolvedValue('before refactor');
    const parts = checkpointParts({ conversationAnchor: vi.fn(async () => undefined) });

    await createCheckpoint(parts);

    expect(parts.save).toHaveBeenCalledWith(
      expect.not.objectContaining({ conversation: expect.anything() }),
    );
  });

  it.each([
    ['code', true, false],
    ['both', true, true],
    ['conversation', false, true],
  ])('restoring %s puts back the right halves', async (scope, code, conversation) => {
    windowMock.showQuickPick
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockImplementationOnce(async (items: { scope: string }[]) =>
        items.find((item) => item.scope === scope),
      );
    const parts = checkpointParts();

    await restoreCheckpoint(parts);

    expect(parts.restore).toHaveBeenCalledTimes(code ? 1 : 0);
    expect(parts.rewindConversation).toHaveBeenCalledTimes(conversation ? 1 : 0);
    if (conversation) {
      expect(parts.rewindConversation).toHaveBeenCalledWith(anchored.conversation);
    }
  });

  it('restores code alone when the host offers no conversation rewind', async () => {
    windowMock.showQuickPick.mockImplementationOnce(async (items: unknown[]) => items[0]);
    const parts = checkpointParts({ rewindConversation: undefined });

    await restoreCheckpoint(parts);

    expect(parts.restore).toHaveBeenCalledWith(anchored);
    expect(windowMock.showQuickPick).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the scope question is dismissed', async () => {
    windowMock.showQuickPick
      .mockImplementationOnce(async (items: unknown[]) => items[0])
      .mockResolvedValueOnce(undefined);
    const parts = checkpointParts();

    await restoreCheckpoint(parts);

    expect(parts.restore).not.toHaveBeenCalled();
    expect(parts.rewindConversation).not.toHaveBeenCalled();
  });
});
