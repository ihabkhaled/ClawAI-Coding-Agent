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
  await installExtension(VSIX, extensionsDirectory);
  session = await launchVscode({ extensionsDirectory, workspace: seedWorkspace() });
});

test.afterAll(async () => {
  await session.close();
  // Best effort: the editor may still hold a handle, and a leftover temporary
  // directory is not a test failure.
  try {
    rmSync(extensionsDirectory, { force: true, recursive: true });
  } catch {
    // Nothing to do.
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

  test('every advertised view renders its pane', async () => {
    await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
    // Panes arrive as their providers register, so reading immediately catches
    // a half-built sidebar and reports a working extension as broken.
    const panes = session.window.locator('.sidebar .pane-header');
    await expect.poll(async () => panes.count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(9);
    const headers = await panes.allInnerTexts();

    // One pane per contributed view. A provider that never registers leaves a
    // pane missing entirely, which is the failure this catches.
    for (const expected of [
      'Chat',
      'Getting Started',
      'Model & Route',
      'Context',
      'History',
      'Needs You',
      'Tasks',
      'Findings',
      'Delivered Files',
    ]) {
      expect(headers.join(' | ')).toContain(expected);
    }
  });

  test('the chat view renders a webview rather than an empty panel', async () => {
    await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
    // VS Code hosts a webview in a document-level overlay, not inside the pane
    // element, so the pane being present proves nothing about the webview.
    const frame = session.window.locator('iframe').first();

    await expect(frame).toBeAttached({ timeout: 60_000 });
    expect(await session.window.locator('iframe').count()).toBeGreaterThan(0);
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
