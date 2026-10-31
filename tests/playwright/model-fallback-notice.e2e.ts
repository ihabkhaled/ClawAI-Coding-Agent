import { expect, test } from '@playwright/test';

import { sendState } from './fixtures';

import type { Page } from '@playwright/test';

/**
 * The host tells the user a model was replaced by posting a RUNTIME_PHASE
 * stream event (label "Switched model", description naming both models); the
 * webview renders it as an activity row. `reason` ('credit' | 'rate-limit') is
 * optional and must never be required for the notice to show.
 */
const FROM = 'Kimi K2.6';
const TO = 'Qwen 2.5 Coder 7B';

async function start(page: Page, prompt: string): Promise<string> {
  await page.locator('#prompt').fill(prompt);
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  return (request as { requestId: string }).requestId;
}

async function notice(
  page: Page,
  requestId: string,
  from: string,
  to: string,
  reason?: 'credit' | 'rate-limit',
): Promise<void> {
  await page.evaluate(
    ([id, a, b, why]) => {
      window.__clawMock.send({
        type: 'streamEvent',
        requestId: id,
        event: {
          type: 'RUNTIME_PHASE',
          label: 'Switched model',
          description: `${String(a)} is rate limited; continuing on ${String(b)}`,
          ...(why ? { reason: why } : {}),
        },
      });
    },
    [requestId, from, to, reason],
  );
}

async function overflow(page: Page): Promise<{ doc: number; item: number; view: number }> {
  return page.evaluate(() => {
    const item = [...document.querySelectorAll<HTMLElement>('.activity-item')].find((entry) =>
      entry.textContent.includes('Switched model'),
    );
    if (item === undefined) throw new Error('The notice row is missing.');
    const root = document.documentElement;
    return {
      doc: root.scrollWidth,
      item: item.scrollWidth - item.clientWidth,
      view: root.clientWidth,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

for (const reason of [undefined, 'credit', 'rate-limit'] as const) {
  test(`shows both model names (reason: ${String(reason)})`, async ({ page }) => {
    const requestId = await start(page, 'hello');
    await notice(page, requestId, FROM, TO, reason);

    const item = page.locator(`.message-assistant[data-request-id="${requestId}"] .activity-item`, {
      hasText: 'Switched model',
    });
    await expect(item).toHaveCount(1);
    await expect(item).toBeVisible();
    await expect(item).toContainText('Switched model');
    await expect(item).toContainText(FROM);
    await expect(item).toContainText(TO);
  });
}

test('renders model names as text only and executes nothing', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.evaluate(() => {
    (window as unknown as { __pwned?: boolean }).__pwned = false;
  });
  const evil = '<img src=x onerror="window.__pwned=true;alert(1)">';
  const requestId = await start(page, 'hello');
  await notice(page, requestId, evil, `${evil}</small><script>window.__pwned=true</script>`);

  const item = page.locator(`.message-assistant[data-request-id="${requestId}"] .activity-item`, {
    hasText: 'Switched model',
  });
  await expect(item).toContainText('<img src=x onerror=');
  await expect(item.locator('img, script')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBe(
    false,
  );
  expect(dialogs).toEqual([]);
});

test('the next normal message is still accepted after the notice', async ({ page }) => {
  const requestId = await start(page, 'first');
  await notice(page, requestId, FROM, TO, 'credit');
  await page.evaluate((id) => {
    window.__clawMock.send({
      type: 'result',
      requestId: id,
      result: { content: 'First answer.' },
    });
  }, requestId);
  await expect(
    page.locator(`.message-assistant[data-request-id="${requestId}"] .message-body`),
  ).toContainText('First answer.');

  const second = await start(page, 'second question');
  expect(second).not.toBe(requestId);
  await expect(page.locator('.message-user').last()).toContainText('second question');
  await page.evaluate((id) => {
    window.__clawMock.send({
      type: 'result',
      requestId: id,
      result: { content: 'Second answer.' },
    });
  }, second);
  await expect(
    page.locator(`.message-assistant[data-request-id="${second}"] .message-body`),
  ).toContainText('Second answer.');
  await expect(page.locator('.message-assistant')).toHaveCount(2);
});

for (const direction of ['ltr', 'rtl'] as const) {
  test(`does not overflow at 320px (${direction})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate((dir) => {
      document.documentElement.dir = dir;
      document.documentElement.lang = dir === 'rtl' ? 'ar' : 'en';
    }, direction);
    const requestId = await start(page, 'hello');
    await notice(
      page,
      requestId,
      'A-very-long-provider-model-name-without-any-break-opportunity-1234567890',
      'Another-very-long-model-name-that-keeps-going-and-going-0987654321',
      'rate-limit',
    );
    await expect(page.locator('.activity-item', { hasText: 'Switched model' })).toBeVisible();
    const sizes = await overflow(page);
    expect(sizes.doc).toBeLessThanOrEqual(sizes.view);
    expect(sizes.item).toBeLessThanOrEqual(0);
  });
}
