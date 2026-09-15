import { describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
}));

vi.mock('vscode', () => ({ l10n: { t: (message: string) => message }, window: windowMock }));

const { attachTerminalOutput } = await import('../../src/services/attach-terminal-command');

const terminal = { name: 'bash' } as never;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    terminals: () => [terminal],
    capture: () => ({ terminalName: 'bash', output: 'build failed', command: 'npm test' }),
    insert: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('attachTerminalOutput', () => {
  it('says so when nothing is open', async () => {
    const parts = dependencies({ terminals: () => [] });

    await attachTerminalOutput(parts);

    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('does nothing when the picker is dismissed', async () => {
    windowMock.showQuickPick.mockResolvedValue(undefined);
    const parts = dependencies();

    await attachTerminalOutput(parts);

    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('inserts a tagged block for the chosen terminal', async () => {
    windowMock.showQuickPick.mockResolvedValue({ label: 'bash', terminal });
    const parts = dependencies();

    await attachTerminalOutput(parts);

    expect(parts.insert).toHaveBeenCalledWith(expect.stringContaining('<terminal '));
    expect(parts.insert).toHaveBeenCalledWith(expect.stringContaining('build failed'));
  });

  it('explains the platform limit rather than attaching an empty block', async () => {
    windowMock.showQuickPick.mockResolvedValue({ label: 'bash', terminal });
    const parts = dependencies({ capture: () => undefined });

    await attachTerminalOutput(parts);

    expect(parts.insert).not.toHaveBeenCalled();
    expect(windowMock.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Shell integration'),
    );
  });
});
