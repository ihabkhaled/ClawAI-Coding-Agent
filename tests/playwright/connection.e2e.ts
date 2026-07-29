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
  await expect(page.locator('#backendUrlInput')).toBeFocused();
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
  await expect(page.locator('#connectionForm')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#connectionCancelButton')).toBeVisible();
  await expect(page.locator('#connectionCancelButton')).toBeFocused();
  await page.locator('#connectionCancelButton').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'cancel' });

  await sendState(page, {
    backendStatus: 'error',
    connected: false,
    lastError: 'The backend could not be reached.',
  });
  await expect(page.locator('#connectionError')).toHaveText('The backend could not be reached.');
  await expect(page.locator('#backendUrlInput')).toBeFocused();

  await sendState(page);
  await expect(page.locator('#connectionGate')).toBeHidden();
  await expect(page.locator('#authenticatedUi')).toBeVisible();
  await expect(page.locator('#prompt')).toBeFocused();
  await expect(page.locator('#announcer')).toHaveText('Connected to ClawAI.');

  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'historyLoaded',
      messages: [
        {
          id: 'message-1',
          role: 'USER',
          content: 'private account prompt',
          status: 'COMPLETED',
        },
      ],
    });
    window.__clawMock.send({ type: 'accountReset' });
  });
  await expect(page.locator('#conversationTitle')).toHaveText('New ClawAI chat');
  await expect(page.locator('#conversation .timeline-item')).toHaveCount(0);
  await expect(page.locator('#emptyState')).toBeVisible();

  await sendState(page, { backendStatus: 'disconnected', connected: false });
  await expect(page.locator('#backendUrlInput')).toBeFocused();
  expect(browserIssues).toEqual([]);
});
