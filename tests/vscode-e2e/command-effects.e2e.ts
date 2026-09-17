import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { installExtension, launchVscode, seedWorkspace } from './vscode-harness';

import type { VscodeSession } from './vscode-harness';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);

let session: VscodeSession;
let extensionsDirectory: string;

/**
 * Runs a command and returns whether the palette accepted it.
 *
 * Bounded deliberately. A palette that will not open — because a modal has
 * focus, or the host died — should fail this test in seconds rather than
 * consume the whole suite's budget waiting.
 */
async function runCommand(label: string): Promise<boolean> {
  await session.window.keyboard.press('Escape');
  await session.window.keyboard.press('Control+Shift+P');
  const input = session.window.locator('.quick-input-widget input');
  try {
    await input.waitFor({ state: 'visible', timeout: 10_000 });
  } catch {
    return false;
  }
  await input.fill(`>${label}`);
  await session.window.waitForTimeout(700);
  await session.window.keyboard.press('Enter');
  await session.window.waitForTimeout(3_000);
  return true;
}

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-cmd-ext-'));
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
 * What the extension tells the user before anything is connected.
 *
 * This is the state every first run begins in, and it had never been observed.
 * An extension that starts silent — no status, no next step — leaves a user with
 * a panel and no idea what to do, and every test so far would still pass.
 */
test.describe('unconnected state in real VS Code', () => {
  test('the status bar names the backend it will use', async () => {
    const status = session.window.locator('.statusbar [aria-label*="ClawAI" i]').first();

    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toHaveAttribute('aria-label', /claw\.local/u);
  });

  test('the status bar reports the connection state rather than hiding it', async () => {
    const status = session.window.locator('.statusbar [aria-label*="ClawAI" i]').first();
    const label = (await status.getAttribute('aria-label')) ?? '';

    // Connected or not, it must say which. A status element that shows only a
    // name tells the user nothing they did not already know.
    expect(label).toMatch(/status:/iu);
  });

  test('the setup view tells the user the next thing to do', async () => {
    const sidebar = session.window.locator('.sidebar');

    await expect(sidebar).toContainText('Sign in to ClawAI', { timeout: 60_000 });
  });

  test('the setup view raises workspace trust as its own step', async () => {
    // Trust gates what the agent may touch, so it belongs in onboarding rather
    // than appearing later as a refusal the user cannot explain.
    await expect(session.window.locator('.sidebar')).toContainText('Trust this workspace');
  });
});

/**
 * Commands run from the palette.
 *
 * Existing and being registered was already proven. Running one is a different
 * question: a handler that throws shows a failure toast, and a handler that
 * returns silently shows nothing — and a palette test passes for both.
 */
test.describe('command effects in real VS Code', () => {
  test('Show Logs is accepted by the palette and does not kill the host', async () => {
    expect(await runCommand('Show Logs')).toBe(true);

    // The host surviving is the assertion: a handler that throws during
    // activation takes every later command with it.
    expect(await runCommand('Show Logs')).toBe(true);
  });

  test('Toggle Focus View runs without reporting a failure', async () => {
    expect(await runCommand('Toggle Focus View')).toBe(true);

    const toasts = await session.window
      .locator('.notifications-toasts')
      .allInnerTexts()
      .catch(() => []);
    expect(toasts.join(' ')).not.toMatch(/failed to|unexpected error/iu);
  });

  test('Select Output Style opens a picker', async () => {
    expect(await runCommand('Select Output Style')).toBe(true);

    await expect(session.window.locator('.quick-input-widget')).toBeVisible();
    await session.window.keyboard.press('Escape');
  });

  test('every command stays reachable after the ones above have run', async () => {
    // A crashed extension host empties the palette of its commands, so this is
    // the cheapest possible check that nothing above took the extension down.
    await session.window.keyboard.press('Escape');
    await session.window.keyboard.press('Control+Shift+P');
    const input = session.window.locator('.quick-input-widget input');
    await input.waitFor({ state: 'visible', timeout: 30_000 });
    await input.fill('>ClawAI');
    await session.window.waitForTimeout(1_000);

    expect(
      await session.window.locator('.quick-input-list .monaco-list-row').count(),
    ).toBeGreaterThan(5);
    await session.window.keyboard.press('Escape');
  });
});
