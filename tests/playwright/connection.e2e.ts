import { expect, test } from '@playwright/test';

import { expectWindowsScreenshot, sendState, type MockBridge } from './fixtures';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

test('shows a focused backend connection gateway before revealing the workbench', async ({
  page,
}) => {
  const browserIssues: string[] = [];
  page.on('pageerror', (error) => {
    browserIssues.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserIssues.push(message.text());
    }
  });
  await page.goto('/');
  await sendState(page, {
    backendStatus: 'disconnected',
    connected: false,
    lastError: undefined,
  });

  await expect(page.locator('#connectionGate')).toBeVisible();
  await expect(page.locator('#authenticatedUi')).toBeHidden();
  await expect(page.locator('#workspaceIdentity')).toBeHidden();
  await expect(page.locator('#workspaceActions')).toBeHidden();
  await expect(page.locator('#backendUrlInput')).toHaveValue('https://claw.local');
  await expectWindowsScreenshot(page, 'connect-gateway-dark.png');

  await page.evaluate(() => {
    document.body.dataset.theme = 'light';
  });
  await expect(page.locator('.connection-card')).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await page.evaluate(() => {
    document.body.dataset.theme = 'hc';
  });
  await expect(page.locator('.connection-card')).toHaveCSS('border-color', 'rgb(255, 255, 255)');
  await page.evaluate(() => {
    delete document.body.dataset.theme;
  });

  await page.locator('#backendUrlInput').fill('https://localhost/');
  await page.locator('#connectButton').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'connect', backendUrl: 'https://localhost/' });

  await sendState(page, {
    backendStatus: 'loading',
    connected: false,
  });
  await expect(page.locator('#connectButton')).toBeDisabled();
  await expect(page.locator('#connectionProgress')).toBeVisible();

  await sendState(page, {
    backendStatus: 'error',
    connected: false,
    lastError: 'The backend could not be reached.',
  });
  await expect(page.locator('#connectionError')).toHaveText('The backend could not be reached.');

  await sendState(page);
  await expect(page.locator('#connectionGate')).toBeHidden();
  await expect(page.locator('#authenticatedUi')).toBeVisible();
  expect(browserIssues).toEqual([]);
});
