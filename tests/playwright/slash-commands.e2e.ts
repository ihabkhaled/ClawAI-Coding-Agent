import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

async function offer(page: Page, start: number, end: number, paths: string[]): Promise<void> {
  await page.evaluate(
    (suggestions) => {
      window.__clawMock.send({ type: 'mentionSuggestions', ...suggestions });
    },
    { start, end, paths },
  );
}

test('inserts a command without doubling its slash', async ({ page }) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('/rev');
  await offer(page, 0, 4, ['/review']);
  await prompt.press('Enter');

  await expect(prompt).toHaveValue('/review ');
});

test('still marks a file suggestion as a mention', async ({ page }) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('see app');
  await prompt.press('End');
  await offer(page, 4, 7, ['src/app.ts']);
  await prompt.press('Enter');

  await expect(prompt).toHaveValue('see @src/app.ts ');
});
