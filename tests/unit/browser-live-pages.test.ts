import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_BROWSER_PAGE_READ_CHARS } from '../../src/core/browser-reference.constants';
import { BrowserLivePageRegistry } from '../../src/infrastructure/browser-live-pages';
import { capturePlaywrightPage } from '../../src/infrastructure/playwright-browser-state-capture';

function fakePage() {
  let closed = false;
  return {
    close: () => {
      closed = true;
    },
    isClosed: () => closed,
  };
}

describe('BrowserLivePageRegistry', () => {
  it('returns the newest page that is still open', () => {
    const registry = new BrowserLivePageRegistry<ReturnType<typeof fakePage>>();
    const first = fakePage();
    const second = fakePage();
    registry.track(first);
    registry.track(second);

    expect(registry.latest()).toBe(second);
    second.close();
    expect(registry.latest()).toBe(first);
    first.close();
    expect(registry.latest()).toBeUndefined();
  });

  it('moves a re-tracked page to the end', () => {
    const registry = new BrowserLivePageRegistry<ReturnType<typeof fakePage>>();
    const first = fakePage();
    registry.track(first);
    registry.track(fakePage());
    registry.track(first);

    expect(registry.latest()).toBe(first);
  });
});

describe('capturePlaywrightPage', () => {
  function livePage() {
    return {
      url: () => 'https://site.test/',
      title: async () => 'Site',
      isClosed: () => false,
      screenshot: vi.fn(async () => new Uint8Array([9])),
      // Runs the page function here, against stubbed page globals, so the
      // in-page read and its bound are exercised rather than faked.
      evaluate: async <Result, Argument>(
        pageFunction: (argument: Argument) => Result,
        argument: Argument,
      ): Promise<Result> => pageFunction(argument),
    };
  }

  beforeEach(() => {
    vi.stubGlobal('document', { body: { innerText: 'body' } });
    vi.stubGlobal('getSelection', () => ({ toString: () => 'sel' }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('bounds what the page hands over', async () => {
    vi.stubGlobal('document', { body: { innerText: 'z'.repeat(MAX_BROWSER_PAGE_READ_CHARS + 5) } });

    const capture = await capturePlaywrightPage(livePage(), false);

    expect(capture.visibleText).toHaveLength(MAX_BROWSER_PAGE_READ_CHARS);
  });

  it('reads an empty selection when the page has none', async () => {
    vi.stubGlobal('getSelection', () => null);

    const capture = await capturePlaywrightPage(livePage(), false);

    expect(capture.selectedText).toBe('');
  });

  it('reads text without a screenshot unless asked', async () => {
    const page = livePage();

    await expect(capturePlaywrightPage(page, false)).resolves.toEqual({
      url: 'https://site.test/',
      title: 'Site',
      selectedText: 'sel',
      visibleText: 'body',
    });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('adds a viewport screenshot when asked', async () => {
    const page = livePage();

    const capture = await capturePlaywrightPage(page, true);

    expect(capture.screenshot).toEqual(new Uint8Array([9]));
    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'png' });
  });
});
