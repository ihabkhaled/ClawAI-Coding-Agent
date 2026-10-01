import { sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
  }
}

export interface Viewport {
  height: number;
  label: string;
  width: number;
}

export type Theme = 'dark' | 'light';
export type Direction = 'ltr' | 'rtl';

/** Width x {portrait, landscape}: landscape keeps the width and shrinks the height like a phone on its side. */
export const viewports: Viewport[] = [
  { label: '320-portrait', width: 320, height: 640 },
  { label: '320-landscape', width: 320, height: 360 },
  { label: '400-portrait', width: 400, height: 800 },
  { label: '400-landscape', width: 400, height: 360 },
  { label: '768-portrait', width: 768, height: 1024 },
  { label: '768-landscape', width: 768, height: 480 },
  { label: '1280-portrait', width: 1280, height: 1600 },
  { label: '1280-landscape', width: 1280, height: 720 },
];

/** The controls this matrix targets: composer rail, attachment chip controls, and the per-turn rewind. */
export const controlSelector = [
  '#attachmentButton',
  '#browserAttachButton',
  '#voiceButton',
  '.attachment-move',
  '.attachment-remove',
  '[data-action="rewind"]',
].join(', ');

export async function prepare(
  page: Page,
  viewport: Viewport,
  direction: Direction,
  theme: Theme,
): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/');
  await sendState(page);
  await page.evaluate(
    ([dir, mode]) => {
      document.documentElement.dir = dir ?? 'ltr';
      document.documentElement.lang = dir === 'rtl' ? 'ar' : 'en';
      document.body.dataset.theme = mode ?? 'dark';
    },
    [direction, theme],
  );
  await page.locator('#attachmentInput').setInputFiles([
    {
      name: 'first-with-a-rather-long-file-name.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('1'),
    },
    { name: 'second.txt', mimeType: 'text/plain', buffer: Buffer.from('2') },
    { name: 'third.txt', mimeType: 'text/plain', buffer: Buffer.from('3') },
  ]);
  await page.evaluate(() => {
    window.__clawMock.send({
      type: 'historyLoaded',
      messages: [
        { id: 'message-1', role: 'USER', content: 'Create the loop file' },
        { id: 'message-2', role: 'ASSISTANT', content: 'Created app/for-loop.js' },
      ],
    });
  });
  await page.locator('[data-action="rewind"]').first().waitFor();
}

export interface ContrastRow {
  name: string;
  ratio: number;
}

/** Contrast of every visible element matching `targets` (the matrix controls by default), composited over the first opaque ancestor background. */
export async function measureContrast(
  page: Page,
  targets: string = controlSelector,
): Promise<ContrastRow[]> {
  return page.evaluate((selector) => {
    type Rgba = [number, number, number, number];
    const parse = (value: string): Rgba => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      const scale = value.startsWith('color(') ? 255 : 1;
      return [
        (numbers[0] ?? 0) * scale,
        (numbers[1] ?? 0) * scale,
        (numbers[2] ?? 0) * scale,
        numbers[3] ?? 1,
      ];
    };
    const over = (top: Rgba, bottom: Rgba): Rgba => {
      const alpha = top[3] + bottom[3] * (1 - top[3]);
      const mix = (index: 0 | 1 | 2): number =>
        alpha === 0 ? 0 : (top[index] * top[3] + bottom[index] * bottom[3] * (1 - top[3])) / alpha;
      return [mix(0), mix(1), mix(2), alpha];
    };
    const luminance = (color: Rgba): number => {
      const channel = (value: number): number => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
    };
    const background = (element: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        layers.push(parse(getComputedStyle(node).backgroundColor));
      }
      return layers.reduceRight<Rgba>((below, layer) => over(layer, below), [255, 255, 255, 1]);
    };
    const rows: { name: string; ratio: number }[] = [];
    document.querySelectorAll(selector).forEach((element) => {
      if (element.getClientRects().length === 0 || (element as HTMLButtonElement).disabled) {
        return;
      }
      const style = getComputedStyle(element);
      const back = background(element);
      const fore = over(parse(style.color), back);
      const light = Math.max(luminance(fore), luminance(back));
      const dark = Math.min(luminance(fore), luminance(back));
      const name =
        element.id ||
        `${element.className}:${element.getAttribute('aria-label') ?? element.textContent}`;
      rows.push({ name, ratio: (light + 0.05) / (dark + 0.05) });
    });
    return rows;
  }, targets);
}

export const mediumViewport: Viewport = { label: '400-portrait', width: 400, height: 800 };
