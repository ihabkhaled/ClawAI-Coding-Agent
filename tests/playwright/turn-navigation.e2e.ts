import { expect, test } from '@playwright/test';

import { sendState } from './fixtures';

import type { Page } from '@playwright/test';

async function converse(page: Page, turns: number): Promise<void> {
  const prompt = page.locator('#prompt');
  const composer = page.locator('#composer');
  for (let index = 0; index < turns; index += 1) {
    await prompt.fill(`Question ${String(index + 1)}`);
    await composer.evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
    });
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

test('labels every turn with who said it and where it sits', async ({ page }) => {
  await converse(page, 2);

  const first = page.locator('.timeline-item').first();
  await expect(first).toHaveAttribute('role', 'article');
  await expect(first).toHaveAttribute('aria-label', /turn 1 of/u);
});

test('renumbers the turns as the conversation grows', async ({ page }) => {
  // One submission is two turns: what the user said and the reply to it.
  await converse(page, 1);
  await expect(page.locator('.timeline-item').first()).toHaveAttribute('aria-label', /of 2/u);

  await converse(page, 1);
  await expect(page.locator('.timeline-item').first()).toHaveAttribute('aria-label', /of 4/u);
});

test('reads Alt+Up from nowhere as the most recent turn', async ({ page }) => {
  await converse(page, 3);
  await page.locator('#prompt').press('Alt+ArrowUp');

  await expect(page.locator('.timeline-item').last()).toBeFocused();
});

test('steps back and forward one turn at a time', async ({ page }) => {
  await converse(page, 3);
  await page.locator('#prompt').press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowUp');

  await expect(page.locator('.timeline-item').nth(4)).toBeFocused();

  await page.keyboard.press('Alt+ArrowDown');

  await expect(page.locator('.timeline-item').nth(5)).toBeFocused();
});

test('stops at the newest turn rather than wrapping to the oldest', async ({ page }) => {
  await converse(page, 3);
  await page.locator('#prompt').press('Alt+ArrowUp');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');

  await expect(page.locator('.timeline-item').last()).toBeFocused();
});

test('announces the turn it moved to', async ({ page }) => {
  await converse(page, 2);
  await page.locator('#prompt').press('Alt+ArrowUp');

  await expect(page.locator('#announcer')).toHaveText(/turn 4 of 4/u);
});
