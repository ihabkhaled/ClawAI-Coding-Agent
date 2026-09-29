import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => ({
  window: { showInformationMessage: vi.fn() },
  commands: { executeCommand: vi.fn(async () => undefined) },
}));

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  window: vscodeMock.window,
  commands: vscodeMock.commands,
}));

const { reportDictationUnavailable } =
  await import('../../src/services/dictation-fallback-command');

describe('reportDictationUnavailable', () => {
  beforeEach(() => {
    vscodeMock.window.showInformationMessage.mockReset();
    vscodeMock.commands.executeCommand.mockClear();
  });

  it('names the failure and the Windows dictation shortcut', async () => {
    vscodeMock.window.showInformationMessage.mockResolvedValue(undefined);

    await reportDictationUnavailable('not-allowed', 'win32');

    const message = String(vscodeMock.window.showInformationMessage.mock.calls[0]?.[0]);
    expect(message).toContain('did not allow this panel to use the microphone');
    expect(message).toContain('Win+H');
    expect(vscodeMock.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('suggests Fn twice on macOS and the generic tip elsewhere', async () => {
    vscodeMock.window.showInformationMessage.mockResolvedValue(undefined);

    await reportDictationUnavailable('network', 'darwin');
    await reportDictationUnavailable('unsupported', 'linux');

    expect(String(vscodeMock.window.showInformationMessage.mock.calls[0]?.[0])).toContain(
      'Fn twice',
    );
    expect(String(vscodeMock.window.showInformationMessage.mock.calls[1]?.[0])).toContain(
      'system dictation',
    );
  });

  it('opens the extension search when the user asks for VS Code Speech', async () => {
    vscodeMock.window.showInformationMessage.mockImplementation(
      async (_message: string, action: string) => action,
    );

    await reportDictationUnavailable('audio-capture', 'linux');

    expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.extensions.search',
      '@id:ms-vscode.vscode-speech',
    );
  });

  it('explains an unexpected stop without inventing a cause', async () => {
    vscodeMock.window.showInformationMessage.mockResolvedValue(undefined);

    await reportDictationUnavailable('garbage', 'linux');

    expect(String(vscodeMock.window.showInformationMessage.mock.calls[0]?.[0])).toContain(
      'stopped unexpectedly',
    );
  });
});
