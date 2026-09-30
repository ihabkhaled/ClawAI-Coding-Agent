import { expect, test } from '@playwright/test';

import {
  controlSelector,
  measureContrast,
  prepare,
  viewports,
  type Direction,
  type Theme,
} from './matrix-helpers';

const directions: Direction[] = ['ltr', 'rtl'];
const themes: Theme[] = ['dark', 'light'];

for (const viewport of viewports) {
  for (const direction of directions) {
    for (const theme of themes) {
      test(`layout ${viewport.label} ${direction} ${theme}: no overflow, reachable, sized, contrast`, async ({
        page,
      }) => {
        await prepare(page, viewport, direction, theme);

        const overflow = await page.evaluate(() => ({
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
        }));
        expect(overflow.scroll, 'document scrollWidth').toBeLessThanOrEqual(overflow.client);
        expect(overflow.body, 'body scrollWidth').toBeLessThanOrEqual(overflow.client);

        const controls = await page.evaluate((selector) => {
          const found: { name: string; x: number; right: number; w: number; h: number }[] = [];
          document.querySelectorAll(selector).forEach((element) => {
            const box = element.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) {
              return;
            }
            found.push({
              name: element.id || element.className,
              x: box.left,
              right: box.right,
              w: box.width,
              h: box.height,
            });
          });
          return found;
        }, controlSelector);
        expect(controls.length).toBeGreaterThanOrEqual(8);
        for (const control of controls) {
          expect(control.x, `${control.name} left edge`).toBeGreaterThanOrEqual(-0.5);
          expect(control.right, `${control.name} right edge`).toBeLessThanOrEqual(
            viewport.width + 0.5,
          );
          expect(control.w, `${control.name} width`).toBeGreaterThanOrEqual(24);
          expect(control.h, `${control.name} height`).toBeGreaterThanOrEqual(24);
        }

        for (const row of await measureContrast(page)) {
          expect(row.ratio, `contrast ${row.name}`).toBeGreaterThanOrEqual(4.5);
        }

        await page.screenshot({
          path: `test-results/device-matrix/${viewport.label}-${direction}-${theme}.png`,
        });
      });
    }
  }
}
