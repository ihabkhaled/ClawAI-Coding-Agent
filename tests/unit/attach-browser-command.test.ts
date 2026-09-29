import { describe, expect, it, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showQuickPick: vi.fn(),
}));

vi.mock('vscode', () => ({ l10n: { t: (message: string) => message }, window: windowMock }));

const { attachBrowserState } = await import('../../src/services/attach-browser-command');

const page = {
  url: 'https://site.test/a',
  title: 'A',
  selectedText: '',
  visibleText: 'hello',
  screenshot: new Uint8Array([1, 2, 3]),
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    capture: vi.fn(async () => page),
    acceptsImages: () => true,
    insert: vi.fn(async () => undefined),
    attach: vi.fn(async () => undefined),
    now: () => new Date('2026-09-29T00:00:00.000Z'),
    ...overrides,
  };
}

describe('attachBrowserState', () => {
  it('does nothing when the choice is dismissed', async () => {
    windowMock.showQuickPick.mockResolvedValueOnce(undefined);
    const parts = dependencies();

    await attachBrowserState(parts);

    expect(parts.capture).not.toHaveBeenCalled();
  });

  it('attaches text and screenshot when asked', async () => {
    windowMock.showQuickPick.mockResolvedValueOnce('Page text and screenshot');
    const parts = dependencies();

    await attachBrowserState(parts);

    expect(parts.capture).toHaveBeenCalledWith(true);
    expect(parts.insert).toHaveBeenCalledWith(expect.stringContaining('<browser '));
    expect(parts.attach).toHaveBeenCalledWith(expect.objectContaining({ content: 'AQID' }));
  });

  it('attaches text only when chosen', async () => {
    windowMock.showQuickPick.mockResolvedValueOnce('Page text only');
    const parts = dependencies();

    await attachBrowserState(parts);

    expect(parts.capture).toHaveBeenCalledWith(false);
    expect(parts.attach).not.toHaveBeenCalled();
  });

  it('skips the choice and the image when the model cannot see', async () => {
    windowMock.showQuickPick.mockClear();
    const parts = dependencies({ acceptsImages: () => false });

    await attachBrowserState(parts);

    expect(windowMock.showQuickPick).not.toHaveBeenCalled();
    expect(parts.capture).toHaveBeenCalledWith(false);
    expect(parts.insert).toHaveBeenCalled();
  });

  it('says so when the agent has no page', async () => {
    const parts = dependencies({ acceptsImages: () => false, capture: async () => undefined });

    await attachBrowserState(parts);

    expect(windowMock.showInformationMessage).toHaveBeenCalledWith(
      'The agent has no open browser page to attach.',
    );
    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('warns when the page cannot be read', async () => {
    const parts = dependencies({
      acceptsImages: () => false,
      capture: async () => {
        throw new Error('Target closed');
      },
    });

    await attachBrowserState(parts);

    expect(windowMock.showWarningMessage).toHaveBeenCalled();
    expect(parts.insert).not.toHaveBeenCalled();
  });

  it('keeps the text when the screenshot is unusable', async () => {
    windowMock.showQuickPick.mockResolvedValueOnce('Page text and screenshot');
    const parts = dependencies({ capture: async () => ({ ...page, screenshot: undefined }) });

    await attachBrowserState(parts);

    expect(parts.insert).toHaveBeenCalled();
    expect(parts.attach).not.toHaveBeenCalled();
    expect(windowMock.showInformationMessage).toHaveBeenCalledWith(
      'The page text was attached; the screenshot was too large to attach.',
    );
  });
});
