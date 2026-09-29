import { expect, test } from '@playwright/test';

import { installFakeRecognition, type FakeRecognitionWindow } from './fake-recognition';
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

test('reorders attachments with the keyboard buttons and by dragging a chip', async ({ page }) => {
  await page.locator('#attachmentInput').setInputFiles([
    { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
    { name: 'third.txt', mimeType: 'text/plain', buffer: Buffer.from('three') },
  ]);
  const names = page.locator('.attachment-chip .attachment-name');
  await expect(names).toHaveText(['first.txt', 'second.txt', 'third.txt']);
  await expect(
    page
      .locator('.attachment-chip')
      .first()
      .getByRole('button', { name: 'Move earlier first.txt' }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Move later first.txt' }).click();
  await expect(names).toHaveText(['second.txt', 'first.txt', 'third.txt']);
  await expect(page.locator('#announcer')).toHaveText('first.txt moved to position 2 of 3');

  await page.locator('.attachment-chip').nth(2).dragTo(page.locator('.attachment-chip').first());
  await expect(names).toHaveText(['third.txt', 'second.txt', 'first.txt']);
});

test('shrinks an oversized photo in the webview and says so', async ({ page }) => {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('no 2d context');
    }
    context.fillStyle = '#3366cc';
    context.fillRect(0, 0, 4000, 3000);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (blob === null) {
      throw new Error('no blob');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return window.btoa(binary);
  });
  await page.locator('#attachmentInput').setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(base64, 'base64'),
  });

  const thumbnail = page.locator('.attachment-thumbnail');
  await expect(thumbnail).toHaveCount(1);
  await expect
    .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(2048);
  expect(await thumbnail.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(1536);
  await expect(page.locator('#attachmentStatus')).toContainText('Resized photo.png');
});

test('leaves a small image byte-for-byte alone', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.locator('#attachmentInput').setInputFiles({
    name: 'dot.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(page.locator('#attachmentList')).toContainText(`${String(png.length)} B`);
  await expect(page.locator('#attachmentStatus')).not.toContainText('Resized');
});

test('dictates into the composer at the caret and stops on demand', async ({ page }) => {
  await installFakeRecognition(page);
  await page.locator('#prompt').fill('fix the bug in');
  await page.locator('#voiceButton').click();
  await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'true');

  await page.evaluate(() => {
    (window as unknown as FakeRecognitionWindow).__recognition?.emit([
      ['the parser', true],
      [' today', false],
    ]);
  });
  await expect(page.locator('#prompt')).toHaveValue('fix the bug in the parser today');

  await page.locator('#voiceButton').click();
  await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#prompt')).toHaveValue('fix the bug in the parser today');
});

test('reports an unavailable recogniser to the host instead of failing silently', async ({
  page,
}) => {
  await page.evaluate(() => {
    const target = window as unknown as FakeRecognitionWindow & { SpeechRecognition?: unknown };
    target.webkitSpeechRecognition = undefined;
    target.SpeechRecognition = undefined;
  });
  await page.locator('#voiceButton').click();
  const messages = await page.evaluate(() => window.__clawMock.messages);
  expect(JSON.stringify(messages)).toContain('dictationUnavailable');
  await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'false');
});

test('a denied microphone ends dictation and tells the host why', async ({ page }) => {
  await installFakeRecognition(page);
  await page.locator('#voiceButton').click();
  await page.evaluate(() => {
    (window as unknown as FakeRecognitionWindow).__recognition?.fail('not-allowed');
  });
  await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'false');
  const messages = await page.evaluate(() => window.__clawMock.messages);
  expect(JSON.stringify(messages)).toContain('not-allowed');
});
