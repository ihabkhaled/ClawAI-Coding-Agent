import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';

import { clickOn, pressKey, typeInto, waitFor } from './browser-page-actions';
import { consoleOf, networkOf, resizeTo, screenshotOf, snapshotOf } from './browser-page-view';
import { closeSession, entryText, entryUrl, loadPlaywright, openSession } from './browser-session';
import { assertBrowsableUrl } from './browser-tool-url';
import {
  BROWSER_DEFAULT_MAX_PAGES,
  BROWSER_DEFAULT_MAX_RUN_MS,
  BROWSER_MAX_PAGES,
  BROWSER_MAX_RUN_MS,
  BROWSER_NAVIGATION_TIMEOUT_MS,
  BROWSER_SCRATCH_FOLDER,
  BROWSER_UNTRUSTED_NOTE,
} from './browser-tool.constants';

import type { BrowserLimits, BrowserSession, PlaywrightLoader } from './browser-session.types';
import type { AgentBrowserOptions, BrowserTool } from './browser-tool.types';
import type { Page } from 'playwright-core';

type Args = Readonly<Record<string, unknown>>;

interface ToolState {
  session?: BrowserSession | undefined;
  startedAt?: number | undefined;
  disposed: boolean;
}

interface Context {
  readonly limits: BrowserLimits;
  readonly state: ToolState;
  readonly loader: PlaywrightLoader;
  readonly shutdown: () => Promise<void>;
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}

/** The limits one tool runs under, from what the operator gave. */
export function browserLimits(options: AgentBrowserOptions): BrowserLimits {
  return {
    allowHosts: options.allowHosts ?? [],
    maxPages: clamp(options.maxPages, BROWSER_DEFAULT_MAX_PAGES, BROWSER_MAX_PAGES),
    maxRunMs: clamp(options.maxRunMs, BROWSER_DEFAULT_MAX_RUN_MS, BROWSER_MAX_RUN_MS),
    scratchDirectory:
      options.scratchDirectory ??
      path.join(tmpdir(), BROWSER_SCRATCH_FOLDER, randomUUID().slice(0, 8)),
    executablePath: nonBlank(options.executablePath) ?? nonBlank(env.CLAW_BROWSER_PATH),
  };
}

/**
 * The browser tool for one run: one Chromium, started on the first `open`, with
 * a hard run time, one page by default, and every request address-checked.
 *
 * Calls are served one at a time, in order, because a page is one shared state:
 * two clicks at once would race. Disposing (cancel, run end) closes the browser
 * even in the middle of a call, which then fails instead of hanging.
 */
export function createBrowserTool(
  options: AgentBrowserOptions = {},
  loader: PlaywrightLoader = loadPlaywright,
): BrowserTool {
  const limits = browserLimits(options);
  const state: ToolState = { disposed: false };
  let queue: Promise<unknown> = Promise.resolve();
  const shutdown = async (): Promise<void> => {
    const { session } = state;
    state.session = undefined;
    if (session !== undefined) await closeSession(session);
  };
  const context: Context = { limits, state, loader, shutdown };
  const run = async (operation: string, args: Args, signal?: AbortSignal): Promise<unknown> => {
    if (state.disposed) throw new Error('The browser is closed: the run has ended.');
    if (signal?.aborted === true) throw new Error('The call was cancelled.');
    const onAbort = (): void => {
      void shutdown();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await dispatch(operation, args, context);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  };
  return {
    execute: (operation, args, signal) => {
      const next = queue.then(() => run(operation, args, signal));
      queue = next.catch(() => undefined);
      return next;
    },
    dispose: () => {
      state.disposed = true;
      void shutdown();
    },
  };
}

async function dispatch(operation: string, args: Args, context: Context): Promise<unknown> {
  const { state, limits } = context;
  if (operation === 'close') {
    await context.shutdown();
    return { closed: true };
  }
  if (state.startedAt !== undefined && Date.now() - state.startedAt > limits.maxRunMs) {
    await context.shutdown();
    throw new Error(
      `The browser's run time limit (${String(Math.round(limits.maxRunMs / 1000))} s) is used up.`,
    );
  }
  if (operation === 'open') return open(args, context);
  const { session } = state;
  const page = session?.pages.at(-1);
  if (session === undefined || page === undefined) {
    throw new Error('No page is open. Call browser.page open {url} first.');
  }
  return onPage(operation, args, { session, page, limits });
}

async function onPage(
  operation: string,
  args: Args,
  at: { session: BrowserSession; page: Page; limits: BrowserLimits },
): Promise<unknown> {
  const { session, page } = at;
  if (operation === 'snapshot') return snapshotOf(page, args);
  if (operation === 'click') return clickOn(page, args);
  if (operation === 'type') return typeInto(page, args);
  if (operation === 'press') return pressKey(page, args);
  if (operation === 'wait') return waitFor(page, args);
  if (operation === 'resize') return resizeTo(page, args);
  if (operation === 'console') return consoleOf(session, args);
  if (operation === 'network') return networkOf(session, args);
  if (operation === 'screenshot') {
    const fullPage = args.fullPage === true;
    return screenshotOf(page, session, { directory: at.limits.scratchDirectory, fullPage });
  }
  throw new Error(`Unsupported operation ${operation}`);
}

async function open(args: Args, context: Context): Promise<unknown> {
  const { state, limits } = context;
  const url = assertBrowsableUrl(args.url, limits.allowHosts);
  state.startedAt ??= Date.now();
  state.session ??= await openSession(limits, context.loader);
  const { session } = state;
  if (state.disposed) {
    await closeSession(session);
    throw new Error('The browser is closed: the run has ended.');
  }
  const page = session.pages.at(-1);
  if (page === undefined) throw new Error('The browser has no page to use.');
  session.refused.length = 0;
  let status: number | undefined;
  try {
    const response = await page.goto(url.href, {
      waitUntil: 'load',
      timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
    });
    status = response?.status();
  } catch (error) {
    // A refused navigation commits an error page a moment later; the next goto
    // would be "interrupted" by it, so let it land first.
    await page.waitForURL(/^chrome-error:/u, { timeout: 1_500 }).catch(() => undefined);
    throw navigationFailure(error, session);
  }
  await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => undefined);
  return {
    url: entryUrl(page.url()),
    title: entryText(await page.title().catch(() => '')),
    ...(status === undefined ? {} : { status }),
    ...(session.refused.length > 0 ? { refusedByAddressCheck: [...session.refused] } : {}),
    note: BROWSER_UNTRUSTED_NOTE,
  };
}

function navigationFailure(error: unknown, session: BrowserSession): Error {
  const refused = session.refused.at(-1);
  if (refused !== undefined) return new Error(`Navigation was blocked: ${refused}`);
  const first = (error instanceof Error ? error.message : '').split('\n')[0] ?? '';
  if (/timeout/iu.test(first)) {
    return new Error(
      `The page did not finish loading within ${String(BROWSER_NAVIGATION_TIMEOUT_MS / 1000)} s: the site is slow or not answering, which is not a permission problem. Try open again, or report the site as slow.`,
    );
  }
  return new Error(`The page could not be opened: ${entryText(first)}`);
}
