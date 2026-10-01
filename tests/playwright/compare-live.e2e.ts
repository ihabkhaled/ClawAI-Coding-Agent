import { expect, test } from '@playwright/test';

import { cloudModel, localModel, sendState } from './fixtures';
import { measureContrast, prepare, viewports, type Direction, type Theme } from './matrix-helpers';

import type { Page } from '@playwright/test';

/**
 * Compare draws one card per model as that lane's frames arrive and adds the
 * judge's verdict when it lands. The messages below are the ones the host posts
 * (src/webview/chat-compare-message.ts), carrying the values of a real run
 * (tests/fixtures/compare/real-compare-run.json).
 */
const KIMI = { provider: 'OLLAMA', model: 'kimi-k2.6' };
const GPT = { provider: 'OLLAMA', model: 'gpt-oss:120b' };

const verdict = {
  judgeModel: 'OLLAMA/kimi-k2.6',
  lanes: [
    {
      label: 'B',
      laneIndex: 1,
      model: GPT.model,
      provider: GPT.provider,
      rank: 1,
      reason: 'Concisely answers both questions in exactly two short sentences.',
      score: 9,
    },
    {
      label: 'A',
      laneIndex: 0,
      model: KIMI.model,
      provider: KIMI.provider,
      rank: 2,
      reason: 'Informative but slightly verbose.',
      score: 8,
    },
  ],
  rationale: 'B better adheres to the two short sentences constraint than A.',
  scale: { max: 10, min: 0 },
  status: 'ranked',
  tiedLaneIndices: [],
  winnerLaneIndex: 1,
};

function lane(
  requestId: string,
  target: { provider: string; model: string },
  patch: Record<string, unknown>,
) {
  return {
    type: 'compareLane',
    requestId,
    lane: {
      delta: '',
      elapsedMs: null,
      errorMessage: null,
      inputTokens: null,
      laneId: `group:${target.provider}:${target.model}`,
      outputTokens: null,
      phase: 'connecting',
      ...target,
      ...patch,
    },
  };
}

async function post(page: Page, message: unknown): Promise<void> {
  await page.evaluate((payload) => {
    window.__clawMock.send(payload);
  }, message);
}

async function startCompare(page: Page): Promise<string> {
  await sendState(page, { models: [localModel, cloudModel] });
  await page.locator('#runMode').selectOption('compare');
  await page.locator('#modelChecks input').nth(0).check();
  await page.locator('#modelChecks input').nth(1).check();
  await page.locator('#prompt').fill('What is the capital of France?');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = await page.evaluate(() => window.__clawMock.messages.at(-1));
  return (request as { requestId: string }).requestId;
}

const status = (page: Page) => page.locator('.compare-results [role="status"]');

test('draws each lane as its frames arrive, then the verdict, then reconciles without rebuilding', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const requestId = await startCompare(page);
  // Typing continues while a comparison runs: nothing below may take focus.
  await page.locator('#prompt').focus();

  await post(page, lane(requestId, KIMI, { phase: 'connecting' }));
  await expect(page.locator('article.compare-card')).toHaveCount(1);
  await expect(page.locator('.compare-card .compare-status')).toHaveText('Connecting');
  await expect(page.locator('.compare-results')).toHaveAttribute('aria-busy', 'true');
  await expect(status(page)).toHaveText('kimi-k2.6: Connecting');

  const injected = '<img src=x onerror="window.__pwned=1">';
  await post(page, lane(requestId, GPT, { phase: 'generating', delta: injected, elapsedMs: 2463 }));
  await expect(page.locator('article.compare-card')).toHaveCount(2);
  await expect(page.locator('.compare-card').nth(1).locator('.compare-content')).toHaveText(
    injected,
  );
  await expect(page.locator('.compare-card img')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
    undefined,
  );
  await expect(page.locator('.compare-card').nth(1).locator('.compare-status')).toHaveText(
    'Writing',
  );
  await expect(page.locator('.compare-card').nth(1).locator('.compare-latency')).toHaveText(
    '2463 ms',
  );

  await page.evaluate(() => {
    (window as unknown as { __firstCard: Element | null }).__firstCard =
      document.querySelector('.compare-card');
  });
  await post(page, lane(requestId, KIMI, { phase: 'generating', delta: 'Paris. ' }));
  await post(page, lane(requestId, KIMI, { phase: 'generating', delta: 'It is famous.' }));
  await expect(page.locator('.compare-card').nth(0).locator('.compare-content')).toHaveText(
    'Paris. It is famous.',
  );
  await post(page, lane(requestId, KIMI, { phase: 'finishing', elapsedMs: 3509 }));
  await expect(page.locator('.compare-card').nth(0).locator('.compare-status')).toHaveText(
    'Finishing',
  );

  await post(page, {
    type: 'compareJudge',
    requestId,
    phase: 'ranking',
    judgeModel: 'OLLAMA/kimi-k2.6',
  });
  await expect(page.locator('.judge-banner')).toContainText('OLLAMA/kimi-k2.6');
  await expect(page.locator('.compare-verdict[data-state="ranking"]')).toContainText(
    'The judge is ranking the answers…',
  );
  await expect(status(page)).toHaveText('The judge is ranking the answers…');

  await post(page, { type: 'compareJudge', requestId, phase: 'verdict', verdict });
  const panel = page.locator('.compare-verdict[data-state="ranked"]');
  await expect(panel).toContainText('Winner: gpt-oss:120b');
  await expect(panel.locator('.compare-verdict-item')).toHaveCount(2);
  await expect(panel.locator('.compare-verdict-item').nth(0)).toContainText('Rank 1');
  await expect(panel.locator('.compare-verdict-item').nth(0)).toContainText('Score 9 of 10');
  await expect(panel.locator('.compare-verdict-item').nth(0)).toContainText('Candidate B');
  await expect(panel).toContainText('B better adheres');
  await expect(page.locator('.compare-card').nth(1)).toHaveAttribute('data-winner', 'true');
  await expect(page.locator('.compare-card').nth(1).locator('.compare-winner-chip')).toHaveText(
    'Winner',
  );
  await expect(page.locator('.compare-card').nth(0).locator('.compare-rank-chip')).toHaveText(
    'Rank 2 · Score 8 of 10',
  );
  await expect(status(page)).toHaveText('Judge verdict: Winner: gpt-oss:120b');

  await post(page, {
    type: 'result',
    requestId,
    result: {
      content: 'Comparison complete',
      compare: {
        judgeEnabled: true,
        judgeModel: 'OLLAMA:kimi-k2.6',
        judgeVerdict: verdict,
        responses: [
          {
            ...KIMI,
            content: 'Paris. It is famous.',
            errorMessage: null,
            inputTokens: 976,
            latencyMs: 3409,
            outputTokens: 41,
            status: 'completed',
          },
          {
            ...GPT,
            content: injected,
            errorMessage: null,
            inputTokens: 1023,
            latencyMs: 1714,
            outputTokens: 304,
            status: 'completed',
          },
        ],
      },
    },
  });
  await expect(page.locator('.compare-results')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('article.compare-card')).toHaveCount(2);
  await expect(page.locator('.compare-verdict')).toHaveCount(1);
  await expect(page.locator('.compare-card').nth(0).locator('.compare-status')).toHaveText(
    'Completed',
  );
  await expect(page.locator('.compare-card').nth(0)).toContainText('1017 tokens');
  await expect(page.locator('.compare-card').nth(0).locator('.compare-latency')).toHaveText(
    '3409 ms',
  );
  await expect(page.locator('.compare-card').nth(1).locator('.compare-winner-chip')).toHaveCount(1);
  // The card on screen is the card the lane drew: it was filled, not replaced.
  expect(
    await page.evaluate(
      () =>
        document.querySelector('.compare-card') ===
        (window as unknown as { __firstCard: Element | null }).__firstCard,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('prompt');

  await post(page, lane(requestId, KIMI, { phase: 'generating', delta: ' late frame' }));
  await expect(page.locator('.compare-card').nth(0).locator('.compare-content')).toHaveText(
    'Paris. It is famous.',
  );
});

test('shows a failed lane live, and says so when the judge verdict never came back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const requestId = await startCompare(page);

  await post(page, lane(requestId, KIMI, { phase: 'generating', delta: 'Paris.' }));
  await post(
    page,
    lane(requestId, GPT, { phase: 'failed', errorMessage: 'Provider quota exceeded' }),
  );
  await expect(page.locator('.compare-card').nth(1)).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('.compare-card').nth(1)).toContainText('Provider quota exceeded');
  await post(page, { type: 'compareJudge', requestId, phase: 'verdict', verdict: null });
  await expect(page.locator('.compare-verdict[data-state="missing"]')).toContainText(
    'The judge verdict was not returned.',
  );
});

test('an error or a dropped request clears the live section and later frames are ignored', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const requestId = await startCompare(page);
  await post(page, lane(requestId, KIMI, { phase: 'generating', delta: 'Paris.' }));
  await expect(page.locator('article.compare-card')).toHaveCount(1);

  await post(page, { type: 'error', requestId, message: 'The run was cancelled.' });
  await expect(page.locator('article.compare-card')).toHaveCount(0);
  await post(page, lane(requestId, GPT, { phase: 'generating', delta: 'late' }));
  await expect(page.locator('article.compare-card')).toHaveCount(0);
});

const targets = [320, 400, 768];
const directions: Direction[] = ['ltr', 'rtl'];
const themes: Theme[] = ['dark', 'light'];

for (const width of targets) {
  const viewport = viewports.find(
    (entry) => entry.width === width && entry.label.endsWith('portrait'),
  );
  for (const direction of directions) {
    for (const theme of themes) {
      test(`live compare ${String(width)} ${direction} ${theme}: contained, readable, contrast`, async ({
        page,
      }) => {
        if (viewport === undefined) {
          throw new Error(`no ${String(width)} viewport in the matrix`);
        }
        await prepare(page, viewport, direction, theme);
        // Tall enough that the fixed chrome and composer do not cover the section
        // being photographed; the width is the one under test.
        await page.setViewportSize({ width: viewport.width, height: 1500 });
        const requestId = await startCompare(page);
        await page.evaluate(() => {
          document.querySelector('.model-tray')?.classList.remove('visible');
        });
        await post(
          page,
          lane(requestId, KIMI, {
            phase: 'generating',
            delta:
              'Paris is the capital of France and is famous for the Eiffel Tower, museums and cuisine.',
            elapsedMs: 3509,
          }),
        );
        await post(page, lane(requestId, GPT, { phase: 'thinking' }));
        await post(page, {
          type: 'compareJudge',
          requestId,
          phase: 'ranking',
          judgeModel: 'OLLAMA/kimi-k2.6',
        });

        const measured = async () =>
          page.evaluate(() => ({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
            results: (() => {
              const results = document.querySelector('.compare-results');
              return results === null ? -1 : results.scrollWidth - results.clientWidth;
            })(),
          }));
        let size = await measured();
        expect(size.scroll, 'document scrollWidth while running').toBeLessThanOrEqual(size.client);
        expect(size.results, 'compare section overflow while running').toBeLessThanOrEqual(0);
        await page.locator('.compare-message').screenshot({
          path: `test-results/compare-live/${String(width)}-${direction}-${theme}-running.png`,
        });

        await post(page, { type: 'compareJudge', requestId, phase: 'verdict', verdict });
        size = await measured();
        expect(size.scroll, 'document scrollWidth with verdict').toBeLessThanOrEqual(size.client);
        expect(size.results, 'compare section overflow with verdict').toBeLessThanOrEqual(0);

        const rows = await measureContrast(
          page,
          '.compare-status, .compare-chip, .compare-verdict-title, .compare-verdict-summary, .compare-verdict-reason, .compare-verdict-rationale, .compare-verdict-score, .compare-verdict-label, .judge-banner, .compare-content',
        );
        expect(rows.length).toBeGreaterThan(8);
        expect(
          rows.filter((row) => row.ratio < 4.5).map((row) => `${row.name} ${row.ratio.toFixed(2)}`),
          'elements below 4.5:1',
        ).toEqual([]);
        await page.locator('.compare-message').screenshot({
          path: `test-results/compare-live/${String(width)}-${direction}-${theme}-verdict.png`,
        });
      });
    }
  }
}
