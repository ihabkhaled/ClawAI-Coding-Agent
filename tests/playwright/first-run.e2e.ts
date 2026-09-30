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
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

async function lastMessage(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__clawMock.messages.at(-1));
}

test('signed out shows the connection gate with Connect as the one action', async ({ page }) => {
  await sendState(page, { connected: false, backendStatus: 'disconnected', user: undefined });
  await expect(page.locator('#connectionGate')).toBeVisible();
  await expect(page.locator('#authenticatedUi')).toBeHidden();
  await expect(page.locator('#connectButtonLabel')).toHaveText('Connect to ClawAI');
  await expect(page.locator('#connectButton')).toBeEnabled();
});

test('an unreachable backend before sign-in says so and offers Try again', async ({ page }) => {
  await sendState(page, {
    connected: false,
    backendStatus: 'error',
    lastError: undefined,
    user: undefined,
  });
  await expect(page.locator('#connectionError')).toContainText('cannot reach the backend');
  await expect(page.locator('#connectButtonLabel')).toHaveText('Try again');
  await expect(page.locator('#connectButton')).toBeEnabled();
});

test('an unreachable backend after sign-in offers Try again that refreshes', async ({ page }) => {
  await sendState(page, { backendStatus: 'error' });
  const notice = page.locator('#setupNotice');
  await expect(notice).toContainText('cannot reach the backend');
  await notice.getByRole('button', { name: 'Try again' }).click();
  expect(await lastMessage(page)).toEqual({ type: 'refreshModels' });
});

test('no models explains the empty list and offers Refresh models', async ({ page }) => {
  await sendState(page, { models: [] });
  const notice = page.locator('#setupNotice');
  await expect(notice).toContainText('No models are available');
  await notice.getByRole('button', { name: 'Refresh models' }).click();
  expect(await lastMessage(page)).toEqual({ type: 'refreshModels' });
});

test('an untrusted workspace explains what is off and offers to trust it', async ({ page }) => {
  await sendState(page, {
    workspaceReadiness: {
      hasActiveFile: false,
      hasSelection: false,
      hasWorkspace: true,
      trusted: false,
      workspaceName: 'ClawAI',
    },
  });
  const notice = page.locator('#setupNotice');
  await expect(notice).toContainText('not trusted');
  await notice.getByRole('button', { name: 'Trust this workspace' }).click();
  expect(await lastMessage(page)).toEqual({ type: 'setupAction', action: 'manageTrust' });
});

test('zero data retention explains the limits and opens the setting', async ({ page }) => {
  await sendState(page, { zeroRetention: true });
  const notice = page.locator('#setupNotice');
  await expect(notice).toContainText('Zero data retention is on');
  await notice.getByRole('button', { name: 'Open retention setting' }).click();
  expect(await lastMessage(page)).toEqual({ type: 'setupAction', action: 'openRetention' });
});

test('a healthy first run shows no notice, and a fixed state clears it', async ({ page }) => {
  await sendState(page);
  await expect(page.locator('#setupNotice .setup-notice')).toHaveCount(0);
  await sendState(page, { models: [] });
  await expect(page.locator('#setupNotice .setup-notice')).toHaveCount(1);
  await sendState(page);
  await expect(page.locator('#setupNotice .setup-notice')).toHaveCount(0);
});
