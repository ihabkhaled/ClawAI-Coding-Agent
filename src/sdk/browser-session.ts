import { redactText } from '../core/redaction';

import { startEgressProxy } from './browser-egress-proxy';
import { guardRedirects } from './browser-redirect-guard';
import { addressProblem } from './browser-tool-url';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_ENTRY_MAX_CHARS,
  BROWSER_LOG_MAX_ENTRIES,
  BROWSER_MISSING_MESSAGE,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_REFUSED_MAX,
  BROWSER_VIEWPORT,
} from './browser-tool.constants';

import type {
  BrowserLimits,
  BrowserSession,
  PlaywrightLoader,
  PlaywrightModule,
} from './browser-session.types';
import type { Page, Request, Route } from 'playwright-core';

/** `playwright-core` loaded on first use, so a run that never opens a browser never pays for it. */
export const loadPlaywright: PlaywrightLoader = async () => {
  try {
    const loaded: PlaywrightModule = await import('playwright-core');
    return loaded;
  } catch {
    throw new Error(BROWSER_MISSING_MESSAGE);
  }
};

/** A string cut to the size one report entry may take, with secrets removed. */
export function entryText(value: string): string {
  const clean = redactText(value.replace(/\s+/gu, ' ').trim());
  return clean.length > BROWSER_ENTRY_MAX_CHARS
    ? `${clean.slice(0, BROWSER_ENTRY_MAX_CHARS)}...`
    : clean;
}

/** An address without its fragment, secrets removed, cut to entry size. */
export function entryUrl(raw: string): string {
  return entryText(raw.split('#')[0] ?? raw);
}

function remember<T>(list: T[], entry: T, limit: number): void {
  list.push(entry);
  if (list.length > limit) list.shift();
}

/** Aborts any request the address check refuses, including redirects and a page's own subresources. */
async function guardRequests(session: BrowserSession, limits: BrowserLimits): Promise<void> {
  await session.context.route('**/*', async (route: Route) => {
    const request: Request = route.request();
    const problem = problemFor(request, limits);
    if (problem === undefined) {
      await route.continue().catch(() => undefined);
      return;
    }
    remember(session.refused, `${entryUrl(request.url())}: ${problem}`, BROWSER_REFUSED_MAX);
    await route.abort('blockedbyclient').catch(() => undefined);
  });
}

function problemFor(request: Request, limits: BrowserLimits): string | undefined {
  try {
    return addressProblem(new URL(request.url()), {
      allowHosts: limits.allowHosts,
      navigation: request.isNavigationRequest(),
    });
  } catch {
    return 'The address could not be read';
  }
}

/** Records what a page says and does wrong, and forgets it when the page closes. */
export function attachPage(session: BrowserSession, page: Page): void {
  session.pages.push(page);
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    remember(session.console, { type, text: entryText(message.text()) }, BROWSER_LOG_MAX_ENTRIES);
  });
  page.on('pageerror', (error) => {
    remember(
      session.console,
      { type: 'pageerror', text: entryText(error.message) },
      BROWSER_LOG_MAX_ENTRIES,
    );
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    if (failure.includes('BLOCKED_BY_CLIENT')) return;
    remember(
      session.network,
      { method: request.method(), url: entryUrl(request.url()), failure: entryText(failure) },
      BROWSER_LOG_MAX_ENTRIES,
    );
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    remember(
      session.network,
      {
        method: response.request().method(),
        url: entryUrl(response.url()),
        status: response.status(),
      },
      BROWSER_LOG_MAX_ENTRIES,
    );
  });
  page.on('close', () => {
    const at = session.pages.indexOf(page);
    if (at >= 0) session.pages.splice(at, 1);
  });
}

/** A browser with one blank page, no downloads, no service workers, and the address check on every request. */
export async function openSession(
  limits: BrowserLimits,
  loader: PlaywrightLoader,
): Promise<BrowserSession> {
  const playwright = await loader();
  const executablePath = limits.executablePath;
  const refused: string[] = [];
  const proxy = await startEgressProxy({
    allowHosts: limits.allowHosts,
    resolve: limits.resolver,
    onRefused: (reason) => {
      remember(refused, entryText(reason), BROWSER_REFUSED_MAX);
    },
  });
  const browser = await playwright.chromium
    .launch({
      headless: true,
      ...(executablePath === undefined ? {} : { executablePath }),
      args: ['--disable-dev-shm-usage', '--no-first-run'],
      // Loopback is exempt from a proxy unless said otherwise; here nothing is.
      proxy: { server: proxy.server, bypass: '<-loopback>' },
    })
    .catch(async (error: unknown) => {
      await proxy.close();
      throw new Error(launchMessage(error));
    });
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
    viewport: { ...BROWSER_VIEWPORT },
  });
  context.setDefaultNavigationTimeout(BROWSER_NAVIGATION_TIMEOUT_MS);
  context.setDefaultTimeout(BROWSER_ACTION_TIMEOUT_MS);
  const session: BrowserSession = {
    browser,
    proxy,
    context,
    pages: [],
    console: [],
    network: [],
    refused,
    blockedPopups: 0,
    screenshots: 0,
  };
  await guardRequests(session, limits);
  const first = await context.newPage();
  attachPage(session, first);
  await guardRedirects(session, first, limits);
  context.on('page', (page) => {
    if (session.pages.length >= limits.maxPages) {
      session.blockedPopups += 1;
      page.close().catch(() => undefined);
      return;
    }
    attachPage(session, page);
    guardRedirects(session, page, limits).catch(() => page.close().catch(() => undefined));
  });
  return session;
}

function launchMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return text.includes("Executable doesn't exist") || text.includes('browserType.launch')
    ? 'No browser could be started. Install one with "npx playwright-core install chromium", ' +
        'or point CLAW_BROWSER_PATH at a Chrome or Chromium executable.'
    : `The browser could not be started: ${entryText(text)}`;
}

/** Closes the browser; never throws, because it runs on cancel and on dispose. */
export async function closeSession(session: BrowserSession): Promise<void> {
  await session.browser.close().catch(() => undefined);
  await session.proxy.close().catch(() => undefined);
}
