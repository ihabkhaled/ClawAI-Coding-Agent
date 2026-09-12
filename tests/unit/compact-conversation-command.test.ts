import { describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  withProgress: vi.fn(async (_options: unknown, task: () => Promise<string>) => task()),
}));

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  ProgressLocation: { Notification: 15 },
  window: windowMock,
}));

const { compactConversation } = await import('../../src/services/compact-conversation-command');

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    activeThreadId: () => 'thread-1',
    summarize: vi.fn(async () => 'We chose Zod.'),
    startContinuation: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('compactConversation', () => {
  it('says there is nothing to compact when no conversation is open', async () => {
    windowMock.showInformationMessage.mockResolvedValue(undefined);
    const parts = dependencies({ activeThreadId: () => undefined });

    await compactConversation(parts);

    expect(parts.summarize).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    windowMock.showInformationMessage.mockResolvedValue(undefined);
    const parts = dependencies();

    await compactConversation(parts);

    expect(parts.summarize).not.toHaveBeenCalled();
    expect(parts.startContinuation).not.toHaveBeenCalled();
  });

  it('summarizes the conversation and continues it in a new one', async () => {
    windowMock.showInformationMessage.mockResolvedValue('Summarize and continue');
    const parts = dependencies();

    await compactConversation(parts);

    expect(parts.summarize).toHaveBeenCalledWith('thread-1', expect.stringContaining('Summarize'));
    expect(parts.startContinuation).toHaveBeenCalledWith(expect.stringContaining('We chose Zod.'));
  });

  it('changes nothing when the summary comes back empty', async () => {
    windowMock.showInformationMessage.mockResolvedValue('Summarize and continue');
    const parts = dependencies({ summarize: vi.fn(async () => '   ') });

    await compactConversation(parts);

    expect(parts.startContinuation).not.toHaveBeenCalled();
    expect(windowMock.showWarningMessage).toHaveBeenCalled();
  });
});
