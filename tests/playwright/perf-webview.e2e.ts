import { stdout } from 'node:process';

import { expect, test } from '@playwright/test';

import { sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
    __longTasks: number[];
  }
}

// Budgets are deliberately generous (roughly 5-10x the measured local numbers)
// so a slow CI runner does not flake, but a quadratic regression still fails.
const BUDGET = {
  render200Ms: 1500,
  render1000Ms: 4000,
  render3000Ms: 12000,
  firstRenderMs: 4000,
  streamMs: 6000,
  typingP95Ms: 250,
  longTaskMaxMs: 2500,
  heapGrowthMb: 250,
} as const;

const CODE =
  '```ts\nconst answer = 42;\nfunction add(a: number, b: number) {\n  return a + b;\n}\n```';

function history(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${String(index)}`,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `Message ${String(index)}: please review attachment notes.txt\n${CODE}\n${'lorem ipsum '.repeat(20)}`,
    inputTokens: 10,
    outputTokens: 20,
    provider: 'OLLAMA',
    model: 'qwen',
  }));
}

async function renderHistory(page: Page, count: number): Promise<number> {
  return page.evaluate(async (messages) => {
    const start = performance.now();
    window.__clawMock.send({ type: 'historyLoaded', messages });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return performance.now() - start;
  }, history(count));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push(entry.duration);
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask unsupported: the budget then simply has nothing to check.
    }
  });
});

test('perf: first render and history rendering scale', async ({ page }) => {
  const start = Date.now();
  await page.goto('/');
  await sendState(page);
  await expect(page.locator('#prompt')).toBeVisible();
  const firstRender = Date.now() - start;
  const results: Record<string, number> = { firstRender };
  for (const count of [200, 1000, 3000]) {
    results[`render${String(count)}`] = Math.round(await renderHistory(page, count));
  }
  const domCount = await page.locator('#conversation .message-card').count();
  stdout.write(`PERF_WEBVIEW ${JSON.stringify({ ...results, domCount })}
`);
  expect(domCount).toBe(3000);
  expect(firstRender).toBeLessThan(BUDGET.firstRenderMs);
  expect(results.render200).toBeLessThan(BUDGET.render200Ms);
  expect(results.render1000).toBeLessThan(BUDGET.render1000Ms);
  expect(results.render3000).toBeLessThan(BUDGET.render3000Ms);
});

test('perf: scroll, memory and typing stay responsive on a long thread', async ({ page }) => {
  await page.goto('/');
  await sendState(page);
  await renderHistory(page, 1000);
  const heapBefore = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  await renderHistory(page, 1000);
  const scroll = await page.evaluate(async () => {
    const list = document.querySelector<HTMLElement>('#conversation');
    if (list === null) throw new Error('missing #conversation');
    const scroller = [list, list.parentElement, document.scrollingElement].find(
      (node) => node && node.scrollHeight > node.clientHeight,
    ) as HTMLElement | undefined;
    window.__longTasks.length = 0;
    const frames: number[] = [];
    let last = performance.now();
    for (let step = 0; step < 60; step += 1) {
      if (scroller) scroller.scrollTop += 800;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    return { worstFrame: Math.max(...frames), scrolled: scroller !== undefined };
  });
  const scrollLongTasks = await page.evaluate(() => [...window.__longTasks]);
  await page.locator('#prompt').focus();
  const typing = await page.evaluate(async () => {
    const prompt = document.querySelector<HTMLTextAreaElement>('#prompt');
    if (prompt === null) throw new Error('missing #prompt');
    const samples: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const begin = performance.now();
      prompt.value += 'x';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      samples.push(performance.now() - begin);
    }
    samples.sort((a, b) => a - b);
    return { p95: samples[Math.floor(samples.length * 0.95)], max: samples.at(-1) ?? 0 };
  });
  const heapAfter = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  const heapGrowthMb = Math.round((heapAfter - heapBefore) / 1048576);
  const longestTask = Math.round(Math.max(0, ...scrollLongTasks));
  stdout.write(`PERF_WEBVIEW_INTERACT ${JSON.stringify({ ...scroll, longestTask, typing, heapGrowthMb, heapBefore, heapAfter })}
`);
  expect(longestTask).toBeLessThan(BUDGET.longTaskMaxMs);
  expect(typing.p95).toBeLessThan(BUDGET.typingP95Ms);
  if (heapBefore > 0) {
    expect(heapGrowthMb).toBeLessThan(BUDGET.heapGrowthMb);
  }
});

test('perf: 1000 streamed tokens do not grow quadratically', async ({ page }) => {
  await page.goto('/');
  await sendState(page);
  await renderHistory(page, 200);
  await page.locator('#prompt').fill('stream please');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const requestId = await page.evaluate(
    () => (window.__clawMock.messages.at(-1) as { requestId: string }).requestId,
  );
  const timings = await page.evaluate(async (id) => {
    const cost = (tokens: number) => {
      const begin = performance.now();
      for (let index = 0; index < tokens; index += 1) {
        window.__clawMock.send({
          type: 'streamEvent',
          requestId: id,
          event: { type: 'CONTENT_DELTA', delta: 'tok ' },
        });
      }
      return performance.now() - begin;
    };
    const first = cost(250);
    const rest = cost(750);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return { first, rest, total: first + rest };
  }, requestId);
  await expect(
    page.locator(`article.message-assistant[data-request-id="${requestId}"] .message-body`),
  ).toContainText('tok tok tok');
  stdout.write(`PERF_WEBVIEW_STREAM ${JSON.stringify(timings)}
`);
  expect(timings.total).toBeLessThan(BUDGET.streamMs);
  // Linear cost would make 750 tokens ~3x the first 250; allow 8x before failing.
  expect(timings.rest).toBeLessThan(Math.max(timings.first, 20) * 8);
});
