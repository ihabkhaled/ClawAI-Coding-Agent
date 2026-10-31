import { expect, test } from '@playwright/test';

import { sendState } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * The host offers to summarize a long thread by posting `compactionOffer`; the
 * webview shows an inline card (never a dialog) and answers with
 * `compactionDecision`. The card is text only and belongs to one thread.
 */
const THREAD = 'thread-one';
const OTHER_THREAD = 'thread-two';
const FIRST_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_ID = '22222222-2222-4222-8222-222222222222';

const card = '#conversation section#compactionOffer.compaction-offer';
const accept = `${card} button[data-action="compaction-accept"]`;
const decline = `${card} button[data-action="compaction-decline"]`;

interface Decision {
  type: string;
  requestId: string;
  accept: boolean;
}

async function setSession(page: Page, threadId: string): Promise<void> {
  await page.evaluate((id) => {
    window.__clawMock.send({
      type: 'session',
      session: { subject: `Subject ${id}`, threadId: id },
    });
  }, threadId);
}

async function offer(
  page: Page,
  fields: Record<string, unknown>,
  threadId: string = THREAD,
  requestId: string = FIRST_ID,
): Promise<void> {
  await page.evaluate(
    (message) => {
      window.__clawMock.send(message);
    },
    { type: 'compactionOffer', requestId, threadId, usedPercent: 87, ...fields },
  );
}

async function decisions(page: Page): Promise<Decision[]> {
  const messages = await page.evaluate(() => window.__clawMock.messages);
  return (messages as Decision[]).filter((message) => message.type === 'compactionDecision');
}

async function start(page: Page, prompt: string): Promise<string> {
  await page.locator('#prompt').fill(prompt);
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  return (request as { requestId: string }).requestId;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
  await setSession(page, THREAD);
});

test('shows the percentage and both buttons, reachable by keyboard', async ({ page }) => {
  await offer(page, { usedPercent: 87 });

  await expect(page.locator(card)).toHaveCount(1);
  await expect(page.locator(card)).toBeVisible();
  await expect(page.locator(card)).toHaveAttribute('role', 'group');
  await expect(page.locator(card)).toHaveAttribute('aria-labelledby', 'compactionOfferTitle');
  await expect(page.locator(card)).toHaveAttribute('data-request-id', FIRST_ID);
  await expect(page.locator(`${card} #compactionOfferTitle`)).not.toBeEmpty();
  await expect(page.locator(`${card} .compaction-offer-text`)).toContainText('87');
  await expect(page.locator(accept)).toBeVisible();
  await expect(page.locator(decline)).toBeVisible();

  let reached = false;
  for (let step = 0; step < 60 && !reached; step += 1) {
    await page.keyboard.press('Tab');
    reached = await page.locator(accept).evaluate((button) => button === document.activeElement);
  }
  expect(reached).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator(decline)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator(accept)).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  expect(await decisions(page)).toEqual([
    { type: 'compactionDecision', requestId: FIRST_ID, accept: true },
  ]);
});

test('declining posts accept false and removes the card', async ({ page }) => {
  await offer(page, { usedPercent: 91 });
  await page.locator(decline).click();

  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  expect(await decisions(page)).toEqual([
    { type: 'compactionDecision', requestId: FIRST_ID, accept: false },
  ]);
});

test('an offer for a different thread is not shown', async ({ page }) => {
  await offer(page, {}, OTHER_THREAD);
  await page.waitForTimeout(200);
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  expect(await decisions(page)).toEqual([]);
});

test('a second offer replaces the first and never duplicates it', async ({ page }) => {
  await offer(page, { usedPercent: 80 }, THREAD, FIRST_ID);
  await expect(page.locator('#compactionOffer')).toHaveCount(1);
  await offer(page, { usedPercent: 95 }, THREAD, SECOND_ID);

  await expect(page.locator('#compactionOffer')).toHaveCount(1);
  await expect(page.locator('#compactionOffer')).toHaveAttribute('data-request-id', SECOND_ID);
  await expect(page.locator(`${card} .compaction-offer-text`)).toContainText('95');
  await expect(page.locator(`${card} button[data-action]`)).toHaveCount(2);
});

test('renders hostile strings as text only and executes nothing', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.evaluate(() => {
    (window as unknown as { __pwned?: boolean }).__pwned = false;
  });
  const evil =
    '<img src=x onerror="window.__pwned=true;alert(1)"><script>window.__pwned=true</script>';

  await offer(page, { usedPercent: 42, title: evil, text: evil, label: evil, model: evil });
  await expect(page.locator(card)).toBeVisible();
  await expect(page.locator(`${card} img, ${card} script`)).toHaveCount(0);

  // A hostile percentage is refused outright, so nothing is rendered either.
  await page.locator(decline).click();
  await offer(page, { usedPercent: evil }, THREAD, SECOND_ID);
  await page.waitForTimeout(300);
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  await expect(page.locator('#conversation img[src="x"], #conversation script')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBe(
    false,
  );
  expect(dialogs).toEqual([]);
});

for (const direction of ['ltr', 'rtl'] as const) {
  test(`does not overflow at 320px (${direction})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
      document.documentElement.lang = dir === 'rtl' ? 'ar' : 'en';
    }, direction);
    await offer(page, { usedPercent: 100 });
    await expect(page.locator(card)).toBeVisible();

    const sizes = await page.evaluate(() => {
      const root = document.documentElement;
      const element = document.querySelector<HTMLElement>('#compactionOffer');
      if (element === null) throw new Error('The offer card is missing.');
      const box = element.getBoundingClientRect();
      return {
        card: element.scrollWidth - element.clientWidth,
        doc: root.scrollWidth,
        left: box.left,
        right: box.right,
        view: root.clientWidth,
      };
    });
    expect(sizes.doc).toBeLessThanOrEqual(sizes.view);
    expect(sizes.card).toBeLessThanOrEqual(0);
    expect(sizes.left).toBeGreaterThanOrEqual(0);
    expect(sizes.right).toBeLessThanOrEqual(sizes.view);
    await expect(page.locator(accept)).toBeVisible();
    await expect(page.locator(decline)).toBeVisible();
  });
}

test('the card is removed when the session moves to another thread', async ({ page }) => {
  await offer(page, {});
  await expect(page.locator('#compactionOffer')).toHaveCount(1);
  await setSession(page, OTHER_THREAD);
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
});

test('the composer still accepts a normal message while the card is shown', async ({ page }) => {
  await offer(page, {});
  await expect(page.locator('#compactionOffer')).toBeVisible();

  const requestId = await start(page, 'keep going');
  expect(requestId).toBeTruthy();
  await expect(page.locator('.message-user').last()).toContainText('keep going');
  await expect(page.locator('#compactionOffer')).toHaveCount(1);
  expect(await decisions(page)).toEqual([]);
});

async function acknowledgements(page: Page): Promise<string[]> {
  const messages = await page.evaluate(() => window.__clawMock.messages);
  return (messages as { type: string; requestId: string }[])
    .filter((message) => message.type === 'compactionOfferShown')
    .map((message) => message.requestId);
}

async function sendHost(page: Page, message: Record<string, unknown>): Promise<void> {
  await page.evaluate((payload) => {
    window.__clawMock.send(payload);
  }, message);
}

test('confirms the card is on screen, and only when it is', async ({ page }) => {
  await offer(page, {}, OTHER_THREAD);
  await page.waitForTimeout(200);
  expect(await acknowledgements(page)).toEqual([]);

  await offer(page, {});
  await expect(page.locator(card)).toBeVisible();
  expect(await acknowledgements(page)).toEqual([FIRST_ID]);
});

test('a repeated offer is confirmed again without a second card', async ({ page }) => {
  await offer(page, {});
  await offer(page, {});

  await expect(page.locator('#compactionOffer')).toHaveCount(1);
  expect(await acknowledgements(page)).toEqual([FIRST_ID, FIRST_ID]);
});

test('an offer that arrived before the session is shown once the session arrives', async ({
  page,
}) => {
  await setSession(page, OTHER_THREAD);
  await offer(page, {});
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  expect(await acknowledgements(page)).toEqual([]);

  await setSession(page, THREAD);
  await offer(page, {});
  await expect(page.locator(card)).toBeVisible();
  expect(await acknowledgements(page)).toEqual([FIRST_ID]);
});

test('a transcript redraw keeps the card and confirms it again', async ({ page }) => {
  await offer(page, {});
  await expect(page.locator(card)).toBeVisible();

  await sendHost(page, { type: 'historyLoaded', messages: [] });

  await expect(page.locator(card)).toHaveCount(1);
  await expect(page.locator(card)).toHaveAttribute('data-request-id', FIRST_ID);
  expect(await acknowledgements(page)).toEqual([FIRST_ID, FIRST_ID]);
});

test('the host closing an offer removes the matching card only', async ({ page }) => {
  await offer(page, {});
  await expect(page.locator(card)).toBeVisible();

  await sendHost(page, { type: 'compactionOfferClosed', requestId: SECOND_ID });
  await expect(page.locator(card)).toHaveCount(1);
  await sendHost(page, { type: 'compactionOfferClosed', requestId: 42 });
  await expect(page.locator(card)).toHaveCount(1);

  await sendHost(page, { type: 'compactionOfferClosed', requestId: FIRST_ID });
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
  expect(await decisions(page)).toEqual([]);

  await sendHost(page, { type: 'historyLoaded', messages: [] });
  await expect(page.locator('#compactionOffer')).toHaveCount(0);
});
