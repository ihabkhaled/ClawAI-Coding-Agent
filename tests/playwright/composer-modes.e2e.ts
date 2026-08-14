import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await sendState(page);
});

test('shows the whole settings popover instead of clipping it to the composer card', async ({
  page,
}) => {
  // The popover is absolutely positioned above its summary, inside a card that
  // clips its own overflow. A fifth control pushed it to three rows and 32px of
  // it — the entire row of labels — was cut off. The clip is released only
  // while the popover is open.
  const closedOverflow = await page.evaluate(() => {
    const card = document.querySelector('.composer-card');
    if (card === null) throw new Error('composer card is missing');
    return getComputedStyle(card).overflow;
  });
  expect(closedOverflow).toBe('hidden');

  await page.locator('#moreSettingsSummary').click();

  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('.secondary-controls');
    const card = document.querySelector('.composer-card');
    if (panel === null || card === null) throw new Error('settings popover is missing');
    const box = panel.getBoundingClientRect();
    return {
      cardOverflow: getComputedStyle(card).overflow,
      bottom: box.bottom,
      height: box.height,
      top: box.top,
      viewport: window.innerHeight,
    };
  });

  expect(geometry.cardOverflow).toBe('visible');
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport);

  // Every label must be on screen. The bug hid these without hiding the select
  // underneath, so the control looked present and unlabelled. Effort now lives
  // on the composer rail beside Send, so it is no longer part of this set.
  for (const label of ['AGENT', 'SPEED', 'APPROVAL', 'CONTEXT', 'WEB RESEARCH', 'THEME']) {
    await expect(
      page.locator('.secondary-controls .compact-control span', { hasText: label }).first(),
    ).toBeInViewport();
  }
});

test('offers three speed modes and posts the selection', async ({ page }) => {
  await page.locator('#moreSettingsSummary').click();
  await expect(page.locator('#speedMode option')).toHaveCount(3);
  await expect(page.locator('#speedMode')).toHaveValue('1X');

  await page.locator('#speedMode').selectOption('2X');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectSpeedMode', mode: '2X' });

  await sendState(page, { speedMode: '1X' });
  await expect(page.locator('#speedMode')).toHaveValue('2X');
});

test('offers all six effort modes and keeps a selection through a state round trip', async ({
  page,
}) => {
  // Effort sits on the composer rail, so it needs no popover to reach it.
  await expect(page.locator('#effortMode')).toBeVisible();
  await expect(page.locator('#effortMode option')).toHaveCount(6);
  await expect(page.locator('#effortMode')).toHaveValue('ULTRA');

  await page.locator('#effortMode').selectOption('LOW');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectEffortMode', mode: 'LOW' });

  // The pending selection has to survive a state frame that still reports the
  // old mode, or the control snaps back under the user mid-change.
  await sendState(page, { effortMode: 'ULTRA' });
  await expect(page.locator('#effortMode')).toHaveValue('LOW');

  await sendState(page, { effortMode: 'LOW' });
  await expect(page.locator('#effortMode')).toHaveValue('LOW');

  await page.locator('#effortMode').selectOption('XHIGH');
  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({ type: 'selectEffortMode', mode: 'XHIGH' });
});
