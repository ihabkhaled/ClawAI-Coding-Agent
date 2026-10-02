import { describeTarget, locate, targetFrom } from './browser-page-target';
import { entryText } from './browser-session';
import {
  BROWSER_ACTION_TIMEOUT_MS,
  BROWSER_MAX_TYPED_CHARS,
  BROWSER_MAX_WAIT_MS,
} from './browser-tool.constants';

import type { Locator, Page } from 'playwright-core';

type Args = Readonly<Record<string, unknown>>;

const SETTLE_MS = 1_500;
const KEY_PATTERN = /^[A-Za-z0-9+_ -]{1,40}$/u;

/** Gives a page that reacted to an action a moment to finish, without waiting on a busy one. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined);
}

async function standing(page: Page): Promise<{ url: string; title: string }> {
  return { url: entryText(page.url()), title: entryText(await page.title().catch(() => '')) };
}

/** A failure the model can act on: what was asked for, and what to try next. */
function failure(error: unknown, what: string): Error {
  const first = (error instanceof Error ? error.message : '').split('\n')[0] ?? '';
  if (/timeout/iu.test(first)) {
    return new Error(
      `${what} was not found or not ready within ${String(BROWSER_ACTION_TIMEOUT_MS / 1000)} s. ` +
        'Take a snapshot and use a ref, or wait for it first.',
    );
  }
  return new Error(`${what} failed: ${entryText(first)}`);
}

async function firstMatch(page: Page, args: Args, operation: string): Promise<Locator> {
  const target = targetFrom(args, operation, { allowText: operation !== 'type' });
  const matches = await locate(page, target);
  if ((await matches.count()) === 0) {
    throw new Error(
      `No element matches ${describeTarget(target)}. Take a snapshot to see what is on the page.`,
    );
  }
  return matches.first();
}

export async function clickOn(page: Page, args: Args): Promise<unknown> {
  const element = await firstMatch(page, args, 'click');
  await element.click({ timeout: BROWSER_ACTION_TIMEOUT_MS }).catch((error: unknown) => {
    throw failure(error, 'The click');
  });
  await settle(page);
  return { clicked: true, ...(await standing(page)) };
}

/** Fills a field; on a drop-down, picks the option with that label (or value) instead. */
async function enter(element: Locator, text: string): Promise<void> {
  const tag: unknown = await element.evaluate((el) => el.tagName);
  if (tag !== 'SELECT') {
    await element.fill(text, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    return;
  }
  const options = { timeout: BROWSER_ACTION_TIMEOUT_MS };
  await element
    .selectOption({ label: text }, options)
    .catch(() => element.selectOption(text, options));
}

/** What the field holds now, so the model sees the effect; never for a password field. */
async function fieldValue(element: Locator): Promise<string | undefined> {
  if ((await element.getAttribute('type').catch(() => null)) === 'password') return undefined;
  const value = await element.inputValue().catch(() => undefined);
  return value === undefined ? undefined : entryText(value);
}

export async function typeInto(page: Page, args: Args): Promise<unknown> {
  const { text } = args;
  if (typeof text !== 'string') throw new Error('browser.page type needs the "text" to enter.');
  if (text.length > BROWSER_MAX_TYPED_CHARS) {
    throw new Error(`type enters at most ${String(BROWSER_MAX_TYPED_CHARS)} characters.`);
  }
  const element = await firstMatch(page, args, 'type');
  await enter(element, text).catch((error: unknown) => {
    throw failure(error, 'Typing into the field');
  });
  const now = await fieldValue(element);
  const submit = args.submit === true;
  if (submit) await page.keyboard.press('Enter');
  if (submit) await settle(page);
  return {
    typed: text.length,
    ...(now === undefined ? {} : { value: now }),
    submitted: submit,
    ...(submit ? await standing(page) : {}),
  };
}

export async function pressKey(page: Page, args: Args): Promise<unknown> {
  const { key } = args;
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error('browser.page press needs a "key" such as Enter, Tab, Escape or ArrowDown.');
  }
  await page.keyboard.press(key).catch((error: unknown) => {
    throw failure(error, `Pressing ${key}`);
  });
  await settle(page);
  return { pressed: key, ...(await standing(page)) };
}

export async function waitFor(page: Page, args: Args): Promise<unknown> {
  const { ms } = args;
  if (ms !== undefined) {
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1 || ms > BROWSER_MAX_WAIT_MS) {
      throw new Error(`wait "ms" is a whole number from 1 to ${String(BROWSER_MAX_WAIT_MS)}.`);
    }
    await page.waitForTimeout(ms);
    return { waitedMs: ms };
  }
  const target = targetFrom(args, 'wait', { allowText: true });
  const matches = await locate(page, target);
  await matches
    .first()
    .waitFor({ state: 'visible', timeout: BROWSER_ACTION_TIMEOUT_MS })
    .catch((error: unknown) => {
      throw failure(error, describeTarget(target));
    });
  return { found: true };
}
