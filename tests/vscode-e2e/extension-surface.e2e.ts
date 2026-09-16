import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { installExtension, launchVscode, paletteOffers, seedWorkspace } from './vscode-harness';

import type { VscodeSession } from './vscode-harness';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
  contributes: { commands: { command: string; title: string }[] };
};
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);
const titles = JSON.parse(readFileSync('package.nls.json', 'utf8')) as Record<string, string>;

/** The user-visible label for a command, resolved the way VS Code resolves it. */
function labelFor(command: string): string {
  const entry = manifest.contributes.commands.find((candidate) => candidate.command === command);
  const key = (entry?.title ?? '').replace(/^%|%$/gu, '');
  return titles[key] ?? key;
}

let session: VscodeSession;
let extensionsDirectory: string;

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-e2e-ext-'));
  installExtension(VSIX, extensionsDirectory);
  session = await launchVscode({ extensionsDirectory, workspace: seedWorkspace() });
});

test.afterAll(async () => {
  await session?.close();
  if (extensionsDirectory !== undefined) {
    rmSync(extensionsDirectory, { force: true, recursive: true });
  }
});

/**
 * What the installed extension actually does inside a running editor.
 *
 * The fixture lane proves the webview markup behaves. Nothing before this proved
 * the editor loads the extension, registers what it advertises, or renders its
 * views — and those are the failures a user meets first.
 */
test.describe('installed extension inside real VS Code', () => {
  test('the window opens with the workbench loaded', async () => {
    await expect(session.window.locator('.monaco-workbench')).toBeVisible({ timeout: 120_000 });
  });

  test('the activity bar shows the extension container', async () => {
    const container = session.window.locator('.activitybar [aria-label*="ClawAI" i]').first();

    await expect(container).toBeVisible({ timeout: 60_000 });
  });

  test('opening the container reveals the extension views', async () => {
    await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();

    await expect(session.window.locator('.sidebar .pane-header').first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('the chat view renders its webview rather than an empty panel', async () => {
    await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
    // A view whose provider never registers renders an empty pane with no error,
    // so the presence of the iframe is the thing worth asserting.
    const frame = session.window.locator('.sidebar iframe.webview').first();

    await expect(frame).toBeAttached({ timeout: 60_000 });
  });

  test('the palette offers the command that opens the chat', async () => {
    const label = labelFor('clawAI.openChat');

    expect(await paletteOffers(session.window, label)).toBe(true);
  });

  test('the palette offers the connect command', async () => {
    const label = labelFor('clawAI.connect');

    expect(await paletteOffers(session.window, label)).toBe(true);
  });

  test('the palette offers the usage command', async () => {
    const label = labelFor('clawAI.showUsage');

    expect(await paletteOffers(session.window, label)).toBe(true);
  });

  test('no extension error notification is showing', async () => {
    // An extension that throws during activation reports it here, and every
    // other assertion in this file can still pass while it does.
    const errors = session.window.locator('.notifications-toasts .notification-list-item-message');
    const count = await errors.count();
    const messages: string[] = [];
    for (let index = 0; index < count; index += 1) {
      messages.push(await errors.nth(index).innerText());
    }

    expect(messages.filter((message) => /clawai/iu.test(message))).toEqual([]);
  });
});
