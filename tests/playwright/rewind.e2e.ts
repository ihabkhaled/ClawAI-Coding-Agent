import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

const browserIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on('pageerror', (error) => {
    issues.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(message.text());
    }
  });
  await page.goto('/');
  await sendState(page);
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

test('offers "Rewind to here" on every saved turn and asks the host to rewind', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'historyLoaded',
      messages: [
        { id: 'message-1', role: 'USER', content: 'Create the loop file' },
        { id: 'message-2', role: 'ASSISTANT', content: 'Created app/for-loop.js' },
        { role: 'ASSISTANT', content: 'A turn with no saved id' },
      ],
    });
  });

  const rewind = page.locator('[data-action="rewind"]');
  await expect(rewind).toHaveCount(2);
  await expect(rewind.first()).toHaveText('Rewind to here');

  await page.locator('.message-user [data-action="rewind"]').click();

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'rewindToMessage', messageId: 'message-1' });
});
