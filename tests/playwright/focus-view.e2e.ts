import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

test('shows the whole cockpit by default', async ({ page }) => {
  await expect(page.locator('body')).toHaveAttribute('data-view-density', 'full');
  await expect(page.locator('#focusToggle')).toHaveAttribute('aria-pressed', 'false');
});

test('asks the extension to change the setting rather than deciding locally', async ({ page }) => {
  await page.locator('#focusToggle').click();

  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__clawMock.messages.find(
          (message) => (message as { type?: string }).type === 'selectViewDensity',
        ),
      ),
    )
    .toMatchObject({ density: 'focus' });
});

test('hides the activity surfaces once the setting comes back as focus', async ({ page }) => {
  await sendState(page, { viewDensity: 'focus' });

  await expect(page.locator('body')).toHaveAttribute('data-view-density', 'focus');
  await expect(page.locator('#modelTray')).toBeHidden();
  await expect(page.locator('#focusToggle')).toHaveAttribute('aria-pressed', 'true');
});

test('keeps the conversation and the composer, which are the point', async ({ page }) => {
  await sendState(page, { viewDensity: 'focus' });

  await expect(page.locator('#composer')).toBeVisible();
  await expect(page.locator('#prompt')).toBeVisible();
});
