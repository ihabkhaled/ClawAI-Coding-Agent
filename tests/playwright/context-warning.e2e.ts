import { expect, test } from '@playwright/test';

import { localModel, sendState } from './fixtures';

/**
 * A small window on purpose. The composer caps a prompt at 20 000 characters,
 * about five thousand tokens, so with a large window the draft alone can never
 * overflow — in practice the warning fires from accumulated history. A narrow
 * model is how the boundary is reachable in one message.
 */
const narrowModel = { ...localModel, key: 'OLLAMA:narrow', contextTokens: 4_096 };

async function withNarrowModel(page: Parameters<typeof sendState>[0]): Promise<void> {
  await sendState(page, {
    models: [narrowModel],
    selectedModel: narrowModel.key,
    routingMode: 'MANUAL_MODEL',
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('says nothing when there is plenty of room', async ({ page }) => {
  await withNarrowModel(page);
  await page.locator('#prompt').fill('short question');

  await expect(page.locator('#contextWarning')).toBeHidden();
});

test('warns while the user can still act on it', async ({ page }) => {
  await withNarrowModel(page);
  // 4096 window: 1024 reserved, 3072 for the prompt, warning above 2611.
  await page.locator('#prompt').fill('x'.repeat(10_600));

  await expect(page.locator('#contextWarning')).toHaveAttribute('data-level', 'tight');
});

test('says plainly when the message will not fit', async ({ page }) => {
  await withNarrowModel(page);
  await page.locator('#prompt').fill('x'.repeat(13_000));

  await expect(page.locator('#contextWarning')).toHaveAttribute('data-level', 'over');
});

test('says nothing it cannot know under automatic routing', async ({ page }) => {
  await sendState(page, { models: [narrowModel], routingMode: 'AUTO' });
  await page.locator('#prompt').fill('x'.repeat(13_000));

  await expect(page.locator('#contextWarning')).toBeHidden();
});
