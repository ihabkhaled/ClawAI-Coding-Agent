import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { redactText } from '../core/redaction';

import { entryText, entryUrl } from './browser-session';
import { browserPageFactsSchema } from './browser-session.schema';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_LOG_REPORT_ENTRIES,
  BROWSER_MAX_VIEWPORT,
  BROWSER_MIN_VIEWPORT,
  BROWSER_MAX_SCREENSHOTS,
  BROWSER_SCREENSHOT_MAX_BYTES,
  BROWSER_SNAPSHOT_CUT_MARKER as CUT_MARKER,
  BROWSER_SNAPSHOT_DEFAULT_CHARS,
  BROWSER_SNAPSHOT_MAX_CHARS,
  BROWSER_SNAPSHOT_TEXT_SHARE,
  BROWSER_UNTRUSTED_NOTE,
  BROWSER_WRAPPER_LINE as WRAPPER_LINE,
  BROWSER_PAGE_FACTS_SCRIPT as PAGE_FACTS_SCRIPT,
} from './browser-tool.constants';

import type { BrowserPageFacts, BrowserSession } from './browser-session.types';
import type { Locator, Page } from 'playwright-core';

type Args = Readonly<Record<string, unknown>>;

function cut(text: string, limit: number): { text: string; cut: boolean } {
  return text.length <= limit
    ? { text, cut: false }
    : { text: text.slice(0, Math.max(0, limit)) + CUT_MARKER, cut: true };
}

function snapshotBudget(value: unknown): number {
  if (value === undefined) return BROWSER_SNAPSHOT_DEFAULT_CHARS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 500) {
    throw new Error(
      `snapshot "maxChars" is a whole number from 500 to ${String(BROWSER_SNAPSHOT_MAX_CHARS)}.`,
    );
  }
  return Math.min(value, BROWSER_SNAPSHOT_MAX_CHARS);
}

/** The accessibility tree without wrapper lines and pointer noise, which cost tokens and say nothing. */
export function compactTree(tree: string): string {
  return tree
    .split('\n')
    .filter((line) => !WRAPPER_LINE.test(line))
    .map((line) => line.replace(' [cursor=pointer]', ''))
    .join('\n');
}

/** The text with every value a password field holds taken out. */
function hideSecrets(text: string, secrets: readonly string[]): string {
  return secrets.reduce((out, secret) => out.split(secret).join('[hidden]'), text);
}

async function factsOf(page: Page): Promise<BrowserPageFacts | undefined> {
  const raw: unknown = await page.evaluate(PAGE_FACTS_SCRIPT).catch(() => '');
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed = browserPageFactsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { ...parsed.data, focus: entryText(parsed.data.focus) } : undefined;
  } catch {
    return undefined;
  }
}

/** The whole page, or the first element a selector names (to read one region of a large page). */
async function snapshotScope(page: Page, selector: unknown): Promise<Locator> {
  if (typeof selector !== 'string' || selector.trim().length === 0) return page.locator('body');
  const scope = page.locator(selector.trim()).first();
  if ((await scope.count()) === 0) {
    throw new Error(
      `No element matches selector "${selector.slice(0, 80)}". Snapshot without a selector.`,
    );
  }
  return scope;
}

/** Visible text and the accessibility tree of the page, bounded and marked as untrusted. */
export async function snapshotOf(page: Page, args: Args): Promise<unknown> {
  const budget = snapshotBudget(args.maxChars);
  const scope = await snapshotScope(page, args.selector);
  const visible = await scope.innerText({ timeout: BROWSER_ACTION_TIMEOUT_MS }).catch(() => '');
  const aria = await scope
    .ariaSnapshot({ mode: 'ai', timeout: BROWSER_ACTION_TIMEOUT_MS })
    .catch(() => '');
  const facts = await factsOf(page);
  const hide = (value: string): string => hideSecrets(redactText(value), facts?.secrets ?? []);
  const textShare = Math.floor(budget * BROWSER_SNAPSHOT_TEXT_SHARE);
  const text = cut(hide(visible.replace(/\n{3,}/gu, '\n\n').trim()), textShare);
  const tree = cut(hide(compactTree(aria)), budget - Math.min(text.text.length, textShare));
  return {
    url: entryUrl(page.url()),
    title: entryText(await page.title().catch(() => '')),
    text: text.text,
    ...(facts === undefined || facts.viewport.length === 0 ? {} : { viewport: facts.viewport }),
    ...(facts?.overflow === true ? { horizontalOverflow: true } : {}),
    ...(facts === undefined || facts.focus.length === 0 ? {} : { focused: facts.focus }),
    accessibility: tree.text,
    ...(text.cut || tree.cut ? { truncated: true } : {}),
    note: BROWSER_UNTRUSTED_NOTE,
  };
}

/** A PNG of the page saved under the scratch folder; the model gets its path and size. */
export async function screenshotOf(
  page: Page,
  session: BrowserSession,
  options: { readonly directory: string; readonly fullPage: boolean },
): Promise<unknown> {
  if (session.screenshots >= BROWSER_MAX_SCREENSHOTS) {
    throw new Error(`A run keeps at most ${String(BROWSER_MAX_SCREENSHOTS)} screenshots.`);
  }
  let image = await page.screenshot({ type: 'png', fullPage: options.fullPage });
  if (image.length > BROWSER_SCREENSHOT_MAX_BYTES) {
    image = await page.screenshot({ type: 'png', fullPage: false });
  }
  if (image.length > BROWSER_SCREENSHOT_MAX_BYTES) {
    throw new Error('The screenshot is too large to keep.');
  }
  session.screenshots += 1;
  await mkdir(options.directory, { recursive: true });
  const file = path.join(options.directory, `shot-${String(session.screenshots)}.png`);
  await writeFile(file, image);
  return {
    path: file,
    bytes: image.length,
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
    url: entryUrl(page.url()),
  };
}

/** Sets the viewport and reports whether the page now scrolls sideways, for checks at phone, tablet and desktop widths. */
export async function resizeTo(page: Page, args: Args): Promise<unknown> {
  const { width, height } = args;
  const fits = (value: unknown): value is number =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BROWSER_MIN_VIEWPORT &&
    value <= BROWSER_MAX_VIEWPORT;
  if (!fits(width) || !fits(height)) {
    throw new Error(
      `resize needs whole-number "width" and "height" from ${String(BROWSER_MIN_VIEWPORT)} to ${String(BROWSER_MAX_VIEWPORT)}.`,
    );
  }
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(150);
  const facts = await factsOf(page);
  return { width, height, horizontalOverflow: facts?.overflow === true };
}

/** The recent console errors and warnings, newest last. */
export function consoleOf(session: BrowserSession, args: Args): unknown {
  const entries = session.console.slice(-BROWSER_LOG_REPORT_ENTRIES);
  const total = session.console.length;
  if (args.clear === true) session.console.length = 0;
  return { count: total, entries, note: BROWSER_UNTRUSTED_NOTE };
}

/** Failed requests, responses with status 400 or more, and any request the address check refused. */
export function networkOf(session: BrowserSession, args: Args): unknown {
  const entries = session.network.slice(-BROWSER_LOG_REPORT_ENTRIES);
  const total = session.network.length;
  const refused = [...session.refused];
  if (args.clear === true) {
    session.network.length = 0;
    session.refused.length = 0;
  }
  return {
    count: total,
    entries,
    ...(refused.length > 0 ? { refusedByAddressCheck: refused } : {}),
  };
}
