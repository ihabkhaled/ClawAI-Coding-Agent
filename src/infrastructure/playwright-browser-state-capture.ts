import { MAX_BROWSER_PAGE_READ_CHARS } from '../core/browser-reference.constants';

import type { LiveBrowserPage } from './browser-live-pages.types';
import type { BrowserPageCapture } from '../core/browser-reference.types';

/**
 * Reads what the user is looking at in the agent's browser page.
 *
 * Text comes from `innerText`, which is what is rendered: hidden elements and
 * form field values (a typed password among them) are not part of it. The page
 * is asked for a bounded slice so a huge document never crosses the bridge.
 */
export async function capturePlaywrightPage(
  page: LiveBrowserPage,
  includeScreenshot: boolean,
): Promise<BrowserPageCapture> {
  const text = await page.evaluate(
    (limit: number) => ({
      selectedText: (globalThis.getSelection()?.toString() ?? '').slice(0, limit),
      visibleText: globalThis.document.body.innerText.slice(0, limit),
    }),
    MAX_BROWSER_PAGE_READ_CHARS,
  );
  const title = await page.title();
  const base = { url: page.url(), title, ...text };
  if (!includeScreenshot) return base;
  return { ...base, screenshot: await page.screenshot({ fullPage: false, type: 'png' }) };
}
