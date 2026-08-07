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
  await expect(page.locator('#backendEnvironmentLocal')).toBeChecked();
  await expect(page.locator('#frontendEnvironmentLocal')).toBeChecked();
  await expect(page.locator('#backendEnvironmentCloud')).toBeEnabled();
  await expect(page.locator('#frontendEnvironmentCloud')).toBeEnabled();
  await expect(page.locator('#backendUrlInput')).toBeHidden();
  await expect(page.locator('#connectButton')).toBeFocused();
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

  await page.locator('#backendEnvironmentCloud').check();
  await page.locator('#frontendEnvironmentCloud').check();
  await expect(page.locator('#backendUrlInput')).toBeHidden();
  await page.locator('#connectButton').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'connect',
      backendCustomUrl: '',
      backendEnvironment: 'CLOUD',
      frontendCustomUrl: '',
      frontendEnvironment: 'CLOUD',
    });

  await page.locator('#backendEnvironmentCustom').check();
  await page.locator('#frontendEnvironmentLocal').check();
  await page.locator('#backendUrlInput').fill('https://localhost/');
  await page.locator('#connectButton').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'connect',
      backendCustomUrl: 'https://localhost/',
      backendEnvironment: 'CUSTOM',
      frontendCustomUrl: '',
      frontendEnvironment: 'LOCAL',
    });

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
    backendCustomUrl: 'https://localhost',
    backendEnvironment: 'CUSTOM',
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
  await expect(page.locator('#connectButton')).toBeFocused();
  expect(browserIssues).toEqual([]);
});

test('updates separate app connections from the authenticated settings dialog', async ({
  page,
}) => {
  await page.goto('/');
  await sendState(page);
  await page.locator('#moreSettingsSummary').click();
  await page.locator('#connectionSettingsButton').click();

  await expect(page.locator('#connectionSettingsPanel')).toBeVisible();
  await expect(page.locator('#settingsBackendCloud')).toBeEnabled();
  await expect(page.locator('#settingsFrontendCloud')).toBeEnabled();
  await page.locator('#settingsBackendCloud').check();
  await page.locator('#settingsFrontendCloud').check();
  await expect(page.locator('#settingsBackendCustomWrap')).toBeHidden();
  await expect(page.locator('#settingsFrontendCustomWrap')).toBeHidden();
  await page.locator('#connectionSettingsForm button[type="submit"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'configureConnections',
      backendCustomUrl: '',
      backendEnvironment: 'CLOUD',
      frontendCustomUrl: '',
      frontendEnvironment: 'CLOUD',
    });

  // Submitting the dialog is a pointerdown outside the composer's More
  // settings disclosure, which closes it. Reopen before the second round trip.
  await page.locator('#moreSettingsSummary').click();
  await page.locator('#connectionSettingsButton').click();
  await page.locator('#settingsBackendCustom').check();
  await page.locator('#settingsBackendUrl').fill('https://api.example.com/');
  await page.locator('#settingsFrontendCustom').check();
  await page.locator('#settingsFrontendUrl').fill('https://app.example.com/');
  await page.locator('#connectionSettingsForm button[type="submit"]').click();

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'configureConnections',
      backendCustomUrl: 'https://api.example.com/',
      backendEnvironment: 'CUSTOM',
      frontendCustomUrl: 'https://app.example.com/',
      frontendEnvironment: 'CUSTOM',
    });
  await expect(page.locator('#connectionSettingsPanel')).toBeHidden();
});
