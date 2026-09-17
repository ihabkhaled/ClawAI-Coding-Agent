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

/** Text with the Monaco list's injected stylesheet removed. */
function visible(value: string): string {
  const [text = ''] = value.split('.monaco-list');
  return text.replace(/\s+/gu, ' ').trim();
}

async function openSeededFile(): Promise<void> {
  await session.window.keyboard.press('Escape');
  await session.window.keyboard.press('Control+P');
  await session.window.waitForTimeout(1_200);
  await session.window.keyboard.type('app.ts');
  await session.window.waitForTimeout(1_200);
  await session.window.keyboard.press('Enter');
  await session.window.waitForTimeout(2_500);
}

/**
 * What pressing a key visibly did, if anything.
 *
 * Not "a quick input opened": these five bindings do different things. Two
 * open a picker, and the workflow ones start a run that surfaces as a chat tab.
 * The question each test is really asking is whether the keypress reached the
 * extension at all, so any of those three outcomes answers it and none of them
 * is privileged.
 *
 * The editor is clicked first. Every one of these is gated on
 * `editorTextFocus`, and a toast left on screen by an earlier test holds focus
 * — so the key reaches no editor and a working binding looks dead.
 */
async function pressAndObserve(key: string): Promise<string> {
  await session.window.keyboard.press('Escape');
  await session.window.locator('.monaco-editor .view-lines').first().click({ timeout: 15_000 });
  await session.window.waitForTimeout(400);
  await session.window.keyboard.press('Control+A');
  await session.window.waitForTimeout(300);
  const tabsBefore = await session.window.locator('.tabs-container .tab').count();
  await session.window.keyboard.press(key);
  await session.window.waitForTimeout(4_000);

  const picker = await session.window
    .locator('.quick-input-widget')
    .isVisible({ timeout: 2_000 })
    .catch(() => false);
  if (picker) {
    await session.window.keyboard.press('Escape');
    return 'picker';
  }
  if ((await session.window.locator('.tabs-container .tab').count()) > tabsBefore) return 'tab';
  const toast = visible(
    (await session.window
      .locator('.notifications-toasts')
      .textContent({ timeout: 2_000 })
      .catch(() => '')) ?? '',
  );
  return toast.length > 0 ? 'toast' : 'nothing';
}

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-keys-ext-'));
  await installExtension(VSIX, extensionsDirectory);
  session = await launchVscode({ extensionsDirectory, workspace: seedWorkspace() });
  await session.window.waitForTimeout(6_000);
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
 * The contributed keybindings, pressed as a user presses them.
 *
 * A keybinding is a manifest entry until someone presses it. Nothing in the
 * unit lane can tell a working binding from one whose `when` clause never
 * matches, or one whose chord a default VS Code binding already owns — in both
 * cases the key does nothing and the manifest still reads correctly.
 */
test.describe('keybindings in real VS Code', () => {
  test('ctrl+shift+a opens a chat, in the editor area rather than the sidebar', async () => {
    // `reveal()` creates an editor session, so the sidebar staying on Explorer
    // is the correct outcome and not evidence of a dead binding. Asserting on
    // the sidebar is how this binding was first mistaken for broken.
    await session.window.keyboard.press('Control+Shift+A');

    await expect(session.window.locator('.tabs-container')).toContainText('New ClawAI chat', {
      timeout: 30_000,
    });
  });

  test('ctrl+alt+m offers the route to run on', async () => {
    // Dismissed and re-pressed until the picker answers. The catalogue is
    // fetched when the picker opens, and a press that lands while the previous
    // notification still holds focus reaches nothing at all.
    await expect
      .poll(
        async () => {
          await session.window.keyboard.press('Escape');
          await session.window.waitForTimeout(500);
          await session.window.keyboard.press('Control+Alt+M');
          await session.window.waitForTimeout(2_500);
          const rows = session.window.locator('.quick-input-list .monaco-list-row');
          if ((await rows.count()) === 0) return '';
          return visible((await rows.first().textContent()) ?? '');
        },
        { timeout: 60_000 },
      )
      .toContain('AUTO Router');
    await session.window.keyboard.press('Escape');
  });

  test('ctrl+alt+t says there is nothing to reopen rather than doing nothing', async () => {
    // A binding that silently does nothing and one that correctly has nothing
    // to do are the same keypress. The sentence is what separates them.
    await session.window.keyboard.press('Escape');
    await session.window.keyboard.press('Control+Alt+T');

    await expect(session.window.locator('.notifications-toasts')).toContainText(
      /no recently closed/iu,
      { timeout: 30_000 },
    );
  });

  test('the editor-scoped bindings each reach their handler', async () => {
    await openSeededFile();

    // Every one of these is gated on editorTextFocus, so each is also a check
    // that the `when` clause matches a real editor rather than never firing.
    for (const [name, key] of [
      ['Search Run History', 'Control+Alt+H'],
      ['Review Code', 'Control+Alt+R'],
      ['Generate Tests', 'Control+Alt+U'],
      ['Fix Code', 'Control+Alt+X'],
      ['Ask About Selection', 'Control+Shift+Enter'],
    ] as const) {
      expect(await pressAndObserve(key), `${name} did nothing at all`).not.toBe('nothing');
    }
  });

  test('ctrl+alt+escape and ctrl+alt+z are quiet with nothing to act on', async () => {
    await session.window.keyboard.press('Escape');
    await session.window.keyboard.press('Control+Alt+Escape');
    await session.window.waitForTimeout(2_000);
    await session.window.keyboard.press('Control+Alt+Z');
    await session.window.waitForTimeout(2_000);

    const toasts = visible(
      (await session.window
        .locator('.notifications-toasts')
        .textContent({ timeout: 2_000 })
        .catch(() => '')) ?? '',
    );
    expect(toasts).not.toMatch(/unexpected error|cannot read|is not a function/iu);
  });

  test('the palette still answers, so no binding killed the extension host', async () => {
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
