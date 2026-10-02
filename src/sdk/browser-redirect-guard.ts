import { addressProblem } from './browser-tool-url';
import { BROWSER_REFUSED_MAX } from './browser-tool.constants';

import type { BrowserLimits, BrowserSession } from './browser-session.types';
import type { Page } from 'playwright-core';

function problemWith(url: string, resourceType: string, limits: BrowserLimits): string | undefined {
  try {
    return addressProblem(new URL(url), {
      allowHosts: limits.allowHosts,
      navigation: resourceType === 'Document',
    });
  } catch {
    return 'The address could not be read';
  }
}

/**
 * Checks every hop of a redirect.
 *
 * Playwright's own request routing sees the first request of a chain, and the
 * browser then follows the redirect by itself: a public page that answers 302
 * to `http://169.254.169.254/` would reach a private address with no check at
 * all. Each hop is a new request to the browser's network layer, so a session
 * on the page pauses every request, runs the same address check, and fails the
 * ones the check refuses. A page that opens after this runs (a popup) has a
 * short gap before its guard is attached, which is why a popup past the page
 * limit is closed and the default limit is one.
 */
export async function guardRedirects(
  session: BrowserSession,
  page: Page,
  limits: BrowserLimits,
): Promise<void> {
  const cdp = await session.context.newCDPSession(page);
  cdp.on('Fetch.requestPaused', (event) => {
    const problem = problemWith(event.request.url, event.resourceType, limits);
    if (problem === undefined) {
      cdp.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => undefined);
      return;
    }
    if (session.refused.length < BROWSER_REFUSED_MAX) {
      session.refused.push(`${event.request.url.split(/[?#]/u)[0] ?? ''}: ${problem}`);
    }
    cdp
      .send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' })
      .catch(() => undefined);
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
}
