import { expect, test } from '@playwright/test';

import { localModel, sendState, type MockBridge } from './fixtures';

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

test('retries the selected live request with its original execution inputs', async ({ page }) => {
  await page.locator('#prompt').fill('Create the original file');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const firstRequest = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const firstRequestId = (firstRequest as { requestId: string }).requestId;
  await page.evaluate((requestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId,
      result: { content: 'Created the original file' },
    });
  }, firstRequestId);

  await page.locator('#runMode').selectOption('chat');
  await page.locator('#contextMode').selectOption('none');
  await page.locator('#prompt').fill('Explain something else');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const secondRequest = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const secondRequestId = (secondRequest as { requestId: string }).requestId;
  await page.evaluate((requestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId,
      result: { content: 'A different response' },
    });
  }, secondRequestId);

  await page.locator('.message-assistant').first().getByRole('button', { name: 'Retry' }).click();

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      content: 'Create the original file',
      contextMode: 'smart',
      modelKey: 'AUTO',
      requestId: expect.not.stringMatching(firstRequestId),
    });
});

test('retries with the original immutable attachments after the composer is cleared', async ({
  page,
}) => {
  await page.locator('#attachmentInput').setInputFiles({
    name: 'original.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('original bytes'),
  });
  await page.locator('#prompt').fill('Inspect the original attachment');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const first = (await page.evaluate(() => window.__clawMock.messages.at(-1))) as {
    requestId: string;
  };
  await page.evaluate((requestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId,
      result: { content: 'Inspected the original attachment' },
    });
  }, first.requestId);

  await expect(page.locator('#attachmentList')).toBeEmpty();
  await page.locator('.message-assistant').first().getByRole('button', { name: 'Retry' }).click();

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      attachments: [
        {
          clientId: expect.any(String),
          content: 'b3JpZ2luYWwgYnl0ZXM=',
          filename: 'original.txt',
          mimeType: 'text/plain',
          sizeBytes: 14,
        },
      ],
      content: 'Inspect the original attachment',
      contextMode: 'smart',
      modelKey: 'AUTO',
      requestId: expect.not.stringMatching(first.requestId),
    });
  await expect(page.locator('.message-user').last()).toContainText('original.txt');
});

test('preserves Compare and Judge model selections when retrying', async ({ page }) => {
  await sendState(page, {
    models: [
      localModel,
      {
        ...localModel,
        displayName: 'GPT-5',
        id: 'openai-gpt-5',
        isLocal: false,
        key: 'OPENAI:gpt-5',
        model: 'gpt-5',
        provider: 'OPENAI',
        source: 'connector',
      },
    ],
  });
  await page.locator('#runMode').selectOption('judge');
  await page.locator('#contextMode').selectOption('workspace');
  await page.locator('#modelChecks input').nth(0).check();
  await page.locator('#modelChecks input').nth(1).check();
  await page.locator('#prompt').fill('Compare the original implementation');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const comparisonRequest = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const comparisonRequestId = (comparisonRequest as { requestId: string }).requestId;
  await page.evaluate((requestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId,
      result: { content: 'Original judged comparison' },
    });
  }, comparisonRequestId);

  await page.locator('#modelChecks input').nth(0).uncheck();
  await page.locator('#modelChecks input').nth(1).uncheck();
  await page.locator('#runMode').selectOption('agent');
  await page.locator('#contextMode').selectOption('none');
  await page.locator('#prompt').fill('A later request');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await page.locator('.message-assistant').first().getByRole('button', { name: 'Retry' }).click();

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'compare',
      content: 'Compare the original implementation',
      contextMode: 'workspace',
      modelKeys: [localModel.key, 'OPENAI:gpt-5'],
      judgeEnabled: true,
      requestId: expect.not.stringMatching(comparisonRequestId),
    });
});

test('does not offer Retry for loaded history without execution metadata', async ({ page }) => {
  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'historyLoaded',
      messages: [
        {
          id: 'message-user',
          role: 'USER',
          content: 'Explain this workspace',
        },
        {
          id: 'message-assistant',
          role: 'ASSISTANT',
          content: 'This workspace contains an extension.',
        },
      ],
    });
  });

  const historyAssistant = page.locator('.message-assistant');
  await expect(historyAssistant.getByRole('button', { name: 'Copy response' })).toBeVisible();
  await expect(historyAssistant.getByRole('button', { name: 'Retry' })).toHaveCount(0);
});

test('keeps a request visible when queued removal races it becoming active', async ({ page }) => {
  await page.locator('#prompt').fill('First request');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const first = (await page.evaluate(() => window.__clawMock.messages.at(-1))) as {
    requestId: string;
  };

  await page.locator('#prompt').fill('Second request');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const second = (await page.evaluate(() => window.__clawMock.messages.at(-1))) as {
    requestId: string;
  };

  await sendState(page, {
    busy: true,
    generationQueue: {
      active: { id: first.requestId, kind: 'agent', prompt: 'First request' },
      pending: [{ id: second.requestId, kind: 'agent', prompt: 'Second request' }],
    },
  });
  await page
    .locator('.queue-item[data-status="queued"]')
    .getByRole('button', {
      name: 'Remove',
    })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'removeQueued', requestId: second.requestId });

  await sendState(page, {
    busy: true,
    generationQueue: {
      active: { id: second.requestId, kind: 'agent', prompt: 'Second request' },
      pending: [],
    },
  });
  await page.evaluate((requestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId,
      result: { content: 'Second request completed' },
    });
  }, second.requestId);

  await expect(page.getByText('Second request completed')).toBeVisible();
});

test('removes dead Retry actions when request inputs leave the bounded LRU', async ({ page }) => {
  for (let index = 0; index < 26; index += 1) {
    await page.locator('#prompt').fill(`Request ${String(index)}`);
    await page.locator('#composer').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
    });
    const request = (await page.evaluate(() => window.__clawMock.messages.at(-1))) as {
      requestId: string;
    };
    await page.evaluate((requestId) => {
      window.__clawMock.send({
        type: 'result',
        requestId,
        result: { content: `Completed ${requestId}` },
      });
    }, request.requestId);
  }

  await expect(
    page.locator('.message-assistant').first().getByRole('button', { name: 'Retry' }),
  ).toHaveCount(0);
  await expect(page.locator('.message-assistant [data-action="retry"]')).toHaveCount(25);
});
