import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

const SENTENCE = 'Waiting for your approval of the previous request before this one can start';
const WIDTHS = [320, 480, 720] as const;

const approvalRequest = {
  id: '8d4f6eb8-5382-4d50-b005-12320b088673',
  kind: 'finalDiff',
  title: 'Apply file changes',
  message: 'Review the staged changes before applying.',
};

const browserIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on('pageerror', (error) => {
    issues.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') issues.push(message.text());
  });
  await page.goto('/');
  await sendState(page);
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

async function submit(page: Page, text: string): Promise<string> {
  await page.locator('#prompt').fill(text);
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const sent = await page.evaluate(() => window.__clawMock.messages.at(-1));
  return (sent as { requestId: string }).requestId;
}

function queueState(firstId: string, secondId: string | undefined) {
  return {
    busy: true,
    approvalRequest,
    generationQueue: {
      active: [
        {
          concurrencyKey: 'runtime:v2',
          id: firstId,
          kind: 'agent',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'First request',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending:
        secondId === undefined
          ? []
          : [
              {
                concurrencyKey: 'runtime:v2',
                id: secondId,
                kind: 'agent',
                modelLabel: 'Qwen 2.5 Coder 7B',
                prompt: 'Second request',
              },
            ],
    },
  };
}

for (const width of WIDTHS) {
  test(`explains a send that waits for approval and jumps to it at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 640 });
    const first = await submit(page, 'First request');
    await sendState(page, queueState(first, undefined));
    const second = await submit(page, 'Second request');
    // Before the host reports the queue, the card still shows the send-time placeholder.
    const card = page.locator(`.message-assistant[data-request-id="${second}"] .message-body`);
    await expect(card).toHaveText('Reading workspace');

    await sendState(page, queueState(first, second));

    await expect(card).toContainText(SENTENCE);
    await expect(card).not.toContainText('Reading workspace');
    await expect(page.locator('.waiting-run .waiting-reason')).toHaveText(SENTENCE);

    // The approval card overlays the view, so the jump is a keyboard action: Enter on
    // the button moves focus to the approval the person has to answer.
    await page.locator('#prompt').focus();
    await card.getByRole('button', { name: 'Go to approval' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#approvalApprove')).toBeFocused();

    // Nothing spills sideways at this width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/queued-approval-${String(width)}.png` });
  });
}

test('goes back to the normal placeholder once the approval is answered and the request starts', async ({
  page,
}) => {
  const first = await submit(page, 'First request');
  await sendState(page, queueState(first, undefined));
  const second = await submit(page, 'Second request');
  const card = page.locator(`.message-assistant[data-request-id="${second}"] .message-body`);
  await sendState(page, queueState(first, second));
  await expect(card).toContainText(SENTENCE);

  await sendState(page, {
    busy: true,
    approvalRequest: undefined,
    generationQueue: {
      active: [
        {
          concurrencyKey: 'runtime:v2',
          id: second,
          kind: 'agent',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'Second request',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
    },
  });
  await expect(card).toHaveText('Reading workspace');
  await expect(card.getByRole('button')).toHaveCount(0);
});

test('says nothing about approval when the queue waits for another reason', async ({ page }) => {
  const first = await submit(page, 'First request');
  const second = await submit(page, 'Second request');
  await sendState(page, { ...queueState(first, second), approvalRequest: undefined });
  const card = page.locator(`.message-assistant[data-request-id="${second}"] .message-body`);
  await expect(card).not.toContainText('approval');
  await expect(page.locator('.waiting-run .waiting-reason')).not.toContainText('approval');
});

for (const width of WIDTHS) {
  test(`keeps the composer reachable in a short sidebar at ${String(width)}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 260 });
    await expect(page.locator('#prompt')).toBeAttached();
    await page.locator('#prompt').scrollIntoViewIfNeeded();
    const box = await page.locator('#prompt').boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThan(width * 0.5);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
