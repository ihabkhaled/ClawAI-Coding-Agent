import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
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

/**
 * Whether anything is listening on a loopback port.
 *
 * The authorization flow opens a short-lived server on 127.0.0.1 to receive the
 * callback. Finding one is how this lane observes that pressing Connect started
 * a real flow rather than only changing what the panel says.
 */
function portIsTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => {
      resolve(true);
    });
    probe.once('listening', () => {
      probe.close(() => {
        resolve(false);
      });
    });
    probe.listen(port, '127.0.0.1');
  });
}

async function someLoopbackServerAppeared(range: readonly number[]): Promise<boolean> {
  for (const port of range) {
    if (await portIsTaken(port)) return true;
  }
  return false;
}

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-connect-ext-'));
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
 * What pressing Connect does, from the shipped artifact.
 *
 * Signing in needs a browser and an account, so this lane stops short of a
 * session. What it can prove is that the button is wired to something real: a
 * panel that changes and a flow that starts. A Connect that silently does
 * nothing looks identical to one that works until the user waits.
 */
test.describe('connect flow in real VS Code', () => {
  test('starts unconnected, with the onboarding step showing', async () => {
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText('Connect to ClawAI');
  });

  test('offers the local backend selected by default', async () => {
    // The manifest default is the local address, and the panel must agree with
    // it. A panel that defaults elsewhere sends a first run to the wrong host.
    const document = await chatDocument();

    await expect(document.locator('body')).toContainText('https://claw.local');
  });

  test('pressing Connect does something observable rather than nothing', async () => {
    const document = await chatDocument();
    const before = await document.locator('body').innerText();

    await document
      .locator('button', { hasText: /connect/iu })
      .locator('visible=true')
      .first()
      .click();
    await session.window.waitForTimeout(6_000);

    const after = await document.locator('body').innerText();
    const started = await someLoopbackServerAppeared([
      ...Array.from({ length: 40 }, (_, index) => 51_000 + index),
    ]);

    // Either the panel moved on, or a callback server is listening. Both are
    // evidence the click reached the extension; neither happening is not.
    expect(after !== before || started).toBe(true);
  });

  test('does not report an extension error after the attempt', async () => {
    const errors = session.window.locator('.notifications-toasts .notification-list-item-message');
    const count = await errors.count();
    const messages: string[] = [];
    for (let index = 0; index < count; index += 1) {
      messages.push(await errors.nth(index).innerText());
    }

    expect(messages.filter((message) => /unexpected|failed to activate/iu.test(message))).toEqual(
      [],
    );
  });

  test('keeps the panel usable after the attempt', async () => {
    const document = await chatDocument();

    expect(await document.locator('input, textarea, button').count()).toBeGreaterThan(5);
  });
});
