import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { installExtension, launchVscode, seedWorkspace } from './vscode-harness';

import type { VscodeSession } from './vscode-harness';
import type { Frame } from 'playwright';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);

let session: VscodeSession;
let extensionsDirectory: string;

/**
 * The chat webview's own document.
 *
 * VS Code nests a webview twice: an outer `vscode-webview://` frame holds the
 * host shell, and the extension's document is a child of it. Asserting against
 * the outer frame finds an empty shell and reports a working panel as broken.
 */
async function chatDocument(): Promise<Frame> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const frame of session.window.frames()) {
      if (!frame.url().includes('vscode-webview')) continue;
      for (const child of frame.childFrames()) {
        const text = await child
          .locator('body')
          .innerText()
          .catch(() => '');
        if (text.includes('ClawAI')) return child;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('The chat webview never rendered its document');
}

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-chat-ext-'));
  await installExtension(VSIX, extensionsDirectory);
  session = await launchVscode({ extensionsDirectory, workspace: seedWorkspace() });
  await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
});

test.afterAll(async () => {
  await session.close();
  try {
    rmSync(extensionsDirectory, { force: true, recursive: true });
  } catch {
    // A leftover temporary directory is not a test failure.
  }
});

/**
 * What a user actually sees in the panel, from the shipped artifact.
 *
 * Every assertion here is on the extension's own document inside a running
 * editor. The fixture lane renders the same markup from a static page, which
 * cannot tell whether the extension ever produced it.
 */
test.describe('chat webview in real VS Code', () => {
  test('renders the extension document rather than an empty host shell', async () => {
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText('ClawAI');
  });

  test('offers the onboarding step before anything is connected', async () => {
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText('Connect to ClawAI');
  });

  test('offers a local, a cloud and a custom backend', async () => {
    const document = await chatDocument();
    const text = await document.locator('body').innerText();

    // All three must be offered: a build that silently drops one sends every
    // user to whichever remains.
    expect(text).toContain('Local');
    expect(text).toContain('Cloud');
    expect(text).toContain('Custom');
  });

  test('names the local backend address it will actually use', async () => {
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText('https://claw.local');
  });

  test('shows a connect action the user can press', async () => {
    const document = await chatDocument();
    // The onboarding step carries more than one control mentioning Connect, and
    // some belong to sections that are not on screen yet. The question is
    // whether a user can press one, so the visible one is the one that counts.
    const connect = document.locator('button', { hasText: /connect/iu }).locator('visible=true');

    expect(await connect.count()).toBeGreaterThan(0);
    await expect(connect.first()).toBeEnabled({ timeout: 30_000 });
  });

  test('explains that authorization happens in the browser', async () => {
    // The callback release turned on this promise being accurate, so the panel
    // must still say where authorization happens.
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText(/browser/iu);
  });

  test('carries interactive controls rather than a static error page', async () => {
    const document = await chatDocument();

    expect(await document.locator('input, textarea, button').count()).toBeGreaterThan(5);
  });

  test('reports no unhandled error inside the webview document', async () => {
    const document = await chatDocument();
    const text = await document.locator('body').innerText();

    expect(text).not.toMatch(/unexpected error|failed to load|cannot read/iu);
  });
});
