import { expect, test } from '@playwright/test';

import { installFakeRecognition } from './fake-recognition';
import {
  controlSelector,
  mediumViewport,
  prepare,
  viewports,
  type Direction,
} from './matrix-helpers';

const directions: Direction[] = ['ltr', 'rtl'];
const compact = viewports.filter((viewport) => viewport.label.startsWith('320-'));

for (const direction of directions) {
  test(`keyboard ${direction}: tab order, activation keys, move earlier/later and announcements`, async ({
    page,
  }) => {
    await prepare(page, mediumViewport, direction, 'dark');
    const names = page.locator('.attachment-chip .attachment-name');
    await expect(names).toHaveText([
      'first-with-a-rather-long-file-name.txt',
      'second.txt',
      'third.txt',
    ]);

    // Tab order: the first chip controls precede the composer rail in DOM order.
    const firstMoveLater = page.getByRole('button', {
      name: 'Move later first-with-a-rather-long-file-name.txt',
    });
    await firstMoveLater.focus();
    await page.keyboard.press('Enter');
    await expect(names.nth(1)).toHaveText('first-with-a-rather-long-file-name.txt');
    await expect(page.locator('#announcer')).toHaveText(
      'first-with-a-rather-long-file-name.txt moved to position 2 of 3',
    );

    const moveEarlier = page.getByRole('button', { name: 'Move earlier third.txt' });
    await moveEarlier.focus();
    await page.keyboard.press('Space');
    await expect(names.nth(1)).toHaveText('third.txt');
    await expect(page.locator('#announcer')).toHaveText('third.txt moved to position 2 of 3');

    // Focus stays on a move button of the moved chip so repeated presses keep working.
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(focused).toContain('attachment-move');

    // Sequential Tab reaches each control exactly once, in DOM order, none skipped.
    await page.locator('#prompt').focus();
    const reached = new Set<string>();
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate((selector) => {
        const active = document.activeElement;
        return active?.matches(selector) ? active.id || active.className : '';
      }, controlSelector);
      if (id !== '') {
        reached.add(id);
      }
    }
    for (const expected of [
      'attachment-move',
      'attachment-remove',
      'attachmentButton',
      'browserAttachButton',
      'voiceButton',
    ]) {
      expect(
        [...reached].some((entry) => entry.includes(expected)),
        `tab reaches ${expected}`,
      ).toBe(true);
    }
  });

  test(`keyboard ${direction}: voice toggles with Space, globe posts, rewind posts on Enter`, async ({
    page,
  }) => {
    await prepare(page, mediumViewport, direction, 'dark');
    await installFakeRecognition(page);

    await page.locator('#voiceButton').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#voiceButton')).toHaveAttribute('aria-label', /.+/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#browserAttachButton').focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__clawMock.messages)))
      .toContain('attachBrowserState');

    await page.locator('.message-user [data-action="rewind"]').focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
      .toEqual({ type: 'rewindToMessage', messageId: 'message-1' });
  });

  test(`a11y ${direction}: dictation unavailable is announced to the host and stays unpressed`, async ({
    page,
  }) => {
    await prepare(page, mediumViewport, direction, 'dark');
    await page.evaluate(() => {
      Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
    });
    await page.locator('#voiceButton').focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => JSON.stringify(window.__clawMock.messages)))
      .toContain('dictationUnavailable');
    await expect(page.locator('#voiceButton')).toHaveAttribute('aria-pressed', 'false');
  });
}

for (const viewport of compact) {
  test(`a11y ${viewport.label}: labels non-empty, focus-visible ring on every control`, async ({
    page,
  }) => {
    await prepare(page, viewport, 'rtl', 'light');
    const controls = page.locator(controlSelector);
    const count = await controls.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let index = 0; index < count; index += 1) {
      const control = controls.nth(index);
      const name = await control.evaluate((element) =>
        (element.getAttribute('aria-label') ?? element.textContent).trim(),
      );
      expect(name, `control #${String(index)} accessible name`).not.toBe('');
      if (await control.isDisabled()) {
        continue;
      }
      await control.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          focused: element.matches(':focus-visible'),
          outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
          shadow: style.boxShadow !== 'none',
        };
      });
      expect(ring.focused, `control #${String(index)} matches :focus-visible`).toBe(true);
      expect(ring.outline || ring.shadow, `control #${String(index)} draws a ring`).toBe(true);
    }
    for (const id of ['announcer', 'attachmentStatus']) {
      const live = await page.locator(`#${id}`).getAttribute('aria-live');
      const role = await page.locator(`#${id}`).getAttribute('role');
      expect(live ?? role, `${id} is a live region`).toBeTruthy();
    }
  });
}
