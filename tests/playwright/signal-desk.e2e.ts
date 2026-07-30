import { expect, test } from '@playwright/test';

import {
  cloudModel,
  expectWindowsScreenshot,
  localModel,
  sendState,
  type MockBridge,
} from './fixtures';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

test('shows two active runs with independent targeted cancellation', async ({ page }) => {
  await sendState(page, {
    busy: true,
    agentRuns: {
      '00000000-0000-4000-8000-000000000001': {
        files: [],
        phase: 'generating',
        summary: 'Refactoring authentication',
      },
      '00000000-0000-4000-8000-000000000002': {
        files: [],
        phase: 'reading',
        summary: 'Reviewing focused tests',
      },
    },
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'agent',
          modelLabel: 'Claude Sonnet',
          prompt: 'Refactor authentication',
          startedAt: Date.now(),
        },
        {
          concurrencyKey: 'chat-b',
          id: '00000000-0000-4000-8000-000000000002',
          kind: 'chat',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'Review focused tests',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
    },
  });

  await expect(page.locator('#prompt')).toBeEnabled();
  await expect(page.locator('#sendButton')).toContainText('Queue');
  await expect(page.locator('#runDeckCount')).toHaveText('2 running');
  await expect(page.locator('.run-lane')).toHaveCount(2);
  await expect(page.locator('.run-lane').nth(0)).toContainText('Claude Sonnet');
  await expect(page.locator('.run-lane').nth(1)).toContainText('Review focused tests');
  await expectWindowsScreenshot(page, 'signal-desk-parallel.png');
  await page.locator('.run-cancel').nth(1).click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'cancel',
      requestId: '00000000-0000-4000-8000-000000000002',
    });
});

test('shows bounded waiting work with its scheduling reason', async ({ page }) => {
  await sendState(page, {
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'agent',
          modelLabel: 'Claude Sonnet',
          prompt: 'Refactor authentication',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [
        {
          concurrencyKey: 'chat-a',
          id: '00000000-0000-4000-8000-000000000003',
          kind: 'chat',
          modelLabel: 'Claude Sonnet',
          prompt: 'Explain the refactor',
        },
      ],
    },
  });

  await expect(page.locator('#waitingRuns')).toBeVisible();
  await expect(page.locator('.waiting-run')).toContainText('Waiting for this conversation');
  await expect(page.locator('.waiting-run')).toContainText('Explain the refactor');
});

test('renders structured comparison cards with reported token telemetry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await sendState(page, { models: [localModel, cloudModel] });
  await page.locator('#runMode').selectOption('compare');
  await page.locator('#modelChecks input').nth(0).check();
  await page.locator('#modelChecks input').nth(1).check();
  await expect(page.locator('#selectedModelCount')).toHaveText('2 of 5 selected');
  await page.locator('#prompt').fill('Compare the implementations');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  const requestId = (request as { requestId: string }).requestId;

  await page.evaluate((activeRequestId) => {
    window.__clawMock.send({
      type: 'result',
      requestId: activeRequestId,
      result: {
        content: 'Comparison complete',
        compare: {
          responses: [
            {
              provider: 'ANTHROPIC',
              model: 'claude-sonnet',
              content: 'Use a request-owned scheduler.',
              latencyMs: 420,
              inputTokens: 30,
              outputTokens: 12,
              status: 'completed',
              errorMessage: null,
            },
            {
              provider: 'OLLAMA',
              model: 'qwen2.5-coder:7b',
              content: '',
              latencyMs: 910,
              inputTokens: null,
              outputTokens: null,
              status: 'failed',
              errorMessage: 'Local runtime unavailable',
            },
          ],
          judgeEnabled: true,
          judgeModel: 'claude-sonnet',
        },
      },
    });
  }, requestId);

  await expect(page.locator('article.compare-card')).toHaveCount(2);
  await expect(page.locator('.compare-card').nth(0)).toContainText('Completed');
  await expect(page.locator('.compare-card').nth(0)).toContainText('42 tokens');
  await expect(page.locator('.compare-card').nth(1)).toContainText('Failed');
  await expect(page.locator('.compare-card').nth(1)).toContainText('Local runtime unavailable');
  await expect(page.locator('.compare-copy')).toHaveCount(2);
  await expect(page.locator('.judge-banner')).toContainText('claude-sonnet');
  await expectWindowsScreenshot(page, 'signal-desk-compare.png');
  expect(
    (
      await page.locator('.compare-results').evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns;
      })
    )
      .split(' ')
      .filter(Boolean),
  ).toHaveLength(2);
  await page.setViewportSize({ width: 560, height: 780 });
  expect(
    (
      await page.locator('.compare-results').evaluate((element) => {
        return getComputedStyle(element).gridTemplateColumns;
      })
    )
      .split(' ')
      .filter(Boolean),
  ).toHaveLength(1);
});

test('keeps the operational surface legible and contained at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await sendState(page, {
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'agent',
          modelLabel: 'Claude Sonnet',
          prompt: 'Refactor authentication',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
    },
  });

  await expect(page.locator('#runDeck')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  for (const locator of [
    page.locator('#sendButton'),
    page.locator('#attachmentButton'),
    page.locator('#moreSettingsSummary'),
  ]) {
    expect(
      await locator.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(24);
  }
  await page.locator('#moreSettingsSummary').click();
  await expect(page.locator('.secondary-controls')).toBeVisible();
  const operationalFontSizes = await page
    .locator(
      '.run-model, .run-prompt, .run-phase, .run-token-chip, #tokenCount, #sendButton, #modelSelect',
    )
    .evaluateAll((elements) => {
      return elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    });
  expect(Math.min(...operationalFontSizes)).toBeGreaterThanOrEqual(11);
  await expectWindowsScreenshot(page, 'signal-desk-narrow.png');

  await page.setViewportSize({ width: 240, height: 780 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.evaluate(() => {
    document.documentElement.dir = 'rtl';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('respects reduced motion and forced-color borders', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await sendState(page, {
    generationQueue: {
      active: [
        {
          concurrencyKey: 'chat-a',
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'agent',
          modelLabel: 'Claude Sonnet',
          prompt: 'Refactor authentication',
          startedAt: Date.now(),
        },
      ],
      capacity: 2,
      pending: [],
    },
  });

  await expect(page.locator('.run-lane')).toHaveCSS('border-style', 'solid');
  await expect(page.locator('.run-state-marker')).toHaveCSS('animation-iteration-count', '1');
});
