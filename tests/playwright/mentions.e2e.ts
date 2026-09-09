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

async function offer(page: Page, start: number, end: number, paths: string[]): Promise<void> {
  await page.evaluate(
    (suggestions) => {
      window.__clawMock.send({ type: 'mentionSuggestions', ...suggestions });
    },
    { start, end, paths },
  );
}

test('asks the extension for suggestions as the mention is typed', async ({ page }) => {
  await page.locator('#prompt').fill('see @app');

  await expect
    .poll(async () =>
      page.evaluate(() =>
        window.__clawMock.messages.some(
          (message) => (message as { type?: string }).type === 'mentionQuery',
        ),
      ),
    )
    .toBe(true);
});

test('inserts the chosen path and closes the list', async ({ page }) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('see @app');
  await offer(page, 4, 8, ['src/app.ts', 'src/apply.ts']);

  await expect(page.locator('#mentionPanel')).toBeVisible();
  await prompt.press('Enter');

  await expect(prompt).toHaveValue('see @src/app.ts ');
  await expect(page.locator('#mentionPanel')).toBeHidden();
});

test('walks the list with the arrow keys before choosing', async ({ page }) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('see @app');
  await offer(page, 4, 8, ['src/app.ts', 'src/apply.ts']);
  await prompt.press('ArrowDown');
  await prompt.press('Enter');

  await expect(prompt).toHaveValue('see @src/apply.ts ');
});

test('escape dismisses the list and leaves the text alone', async ({ page }) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('see @app');
  await offer(page, 4, 8, ['src/app.ts']);
  await prompt.press('Escape');

  await expect(page.locator('#mentionPanel')).toBeHidden();
  await expect(prompt).toHaveValue('see @app');
});

test('a folder keeps the mention open so the next keystroke narrows inside it', async ({
  page,
}) => {
  const prompt = page.locator('#prompt');
  await prompt.fill('see @sr');
  await offer(page, 4, 7, ['src/']);
  await prompt.press('Enter');

  await expect(prompt).toHaveValue('see @src/');
});
