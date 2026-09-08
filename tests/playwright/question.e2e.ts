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

// The agent had only a yes/no approval attached to a side effect, so a model
// facing a real fork either guessed or wrote the question into its prose and
// carried on without the answer.
test('answers a structured agent question and reports the choice to the host', async ({ page }) => {
  await sendState(page, {
    questionRequest: {
      id: '7a1f0f3e-2b1e-4a9c-9a2a-9d1f5a2c8e11',
      header: 'Storage',
      question: 'Which store should the cache use?',
      options: [{ label: 'Redis' }, { label: 'In-memory', description: 'No persistence' }],
      allowOther: true,
    },
  });

  await expect(page.locator('#questionPanel')).toBeVisible();
  await expect(page.locator('#questionMessage')).toHaveText('Which store should the cache use?');
  await expect(page.locator('#questionOptions button')).toHaveCount(2);

  await page.locator('#questionOptions button', { hasText: 'Redis' }).click();
  await expect(page.locator('#questionOptions button').first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#questionSubmit').click();

  const message = await page.evaluate(() => window.__clawMock.messages.at(-1));
  expect(message).toMatchObject({
    type: 'answerQuestion',
    requestId: '7a1f0f3e-2b1e-4a9c-9a2a-9d1f5a2c8e11',
    selection: { label: 'Redis' },
  });
});

// Typed text wins over a stale selection: a user who picked an option and then
// typed has changed their mind.
test('sends typed free text instead of a previously selected option', async ({ page }) => {
  await sendState(page, {
    questionRequest: {
      id: '7a1f0f3e-2b1e-4a9c-9a2a-9d1f5a2c8e12',
      header: 'Storage',
      question: 'Which store?',
      options: [{ label: 'Redis' }, { label: 'In-memory' }],
      allowOther: true,
    },
  });

  await page.locator('#questionOptions button', { hasText: 'Redis' }).click();
  await page.locator('#questionOther').fill('DynamoDB');
  await page.locator('#questionSubmit').click();

  const message = await page.evaluate(() => window.__clawMock.messages.at(-1));
  expect(message).toMatchObject({ type: 'answerQuestion', selection: { other: 'DynamoDB' } });
});

test('hides free text when the question does not allow it, and dismisses on Escape', async ({
  page,
}) => {
  await sendState(page, {
    questionRequest: {
      id: '7a1f0f3e-2b1e-4a9c-9a2a-9d1f5a2c8e13',
      header: 'Storage',
      question: 'Which store?',
      options: [{ label: 'Redis' }, { label: 'In-memory' }],
      allowOther: false,
    },
  });

  await expect(page.locator('#questionOther')).toBeHidden();

  await page.locator('#questionPanel').press('Escape');

  const message = await page.evaluate(() => window.__clawMock.messages.at(-1));
  expect(message).toMatchObject({ type: 'resolveApproval', approved: false });
});
