import { expect, test } from '@playwright/test';

import { LoopbackAuthorizationServer } from '../../src/core/loopback-authorization';

test('external tab gives a visible fallback under the actual callback CSP', async ({ page }) => {
  const server = await LoopbackAuthorizationServer.open('browser-test-state');
  try {
    await page.goto('about:blank');
    await page.goto('data:text/html,Previous%20page');
    const navigation = page.goto(`${server.callbackUri}?code=test-code&state=browser-test-state`);
    await server.waitForCallback();
    server.confirmAuthorization();
    const response = await navigation;
    expect(response?.headers()['content-security-policy']).toContain("script-src 'nonce-");
    await expect(page).toHaveURL(server.callbackUri);
    await expect(page.getByRole('link', { name: 'Open Chat' })).toHaveAttribute(
      'href',
      'vscode://clawai.clawai-coding-agent/open',
    );
    await page.getByRole('button', { name: 'Close this tab' }).click();
    await expect(page.getByRole('status')).toContainText('Your browser kept this tab open');
    expect(page.isClosed()).toBe(false);
  } finally {
    server.dispose();
  }
});

test('script-opened callback popup closes when requested', async ({ page }) => {
  const server = await LoopbackAuthorizationServer.open('popup-test-state');
  try {
    const popupPromise = page.waitForEvent('popup');
    await page.evaluate((url) => {
      window.open(url);
    }, `${server.callbackUri}?code=test-code&state=popup-test-state`);
    await server.waitForCallback();
    server.confirmAuthorization();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', { name: 'Close this tab' }).click();
    await closed;
    expect(popup.isClosed()).toBe(true);
  } finally {
    server.dispose();
  }
});
