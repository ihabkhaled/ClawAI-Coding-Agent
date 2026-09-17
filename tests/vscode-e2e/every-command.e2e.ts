import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { COMMANDS_NEEDING_A_DIALOG, COMMANDS_PER_EDITOR } from './every-command.constants';
import { installExtension, launchVscode, seedWorkspace } from './vscode-harness';

import type { VscodeSession } from './vscode-harness';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  readonly version: string;
  readonly contributes: { readonly commands: readonly { readonly title: string }[] };
};
const messages = JSON.parse(readFileSync('package.nls.json', 'utf8')) as Record<string, string>;
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);

/** The label a user types into the palette, resolved from the manifest's nls key. */
function displayTitle(title: string): string {
  const key = title.replace(/^%|%$/gu, '');
  return messages[key] ?? title;
}

const titles = manifest.contributes.commands
  .map((command) => displayTitle(command.title))
  .filter((title) => !COMMANDS_NEEDING_A_DIALOG.includes(title));

/**
 * The commands, cut into slices that each get their own editor.
 *
 * A single editor stops responding at the twenty-third command invocation
 * whichever commands those are — documented in `docs/parity/PROGRAM.md` as an
 * open question. Restarting the editor well short of that boundary is what
 * makes the remaining commands testable at all; it is a workaround, and the
 * underlying question stays open.
 */
const slices = Array.from({ length: Math.ceil(titles.length / COMMANDS_PER_EDITOR) }, (_, index) =>
  titles.slice(index * COMMANDS_PER_EDITOR, (index + 1) * COMMANDS_PER_EDITOR),
);

for (const [index, slice] of slices.entries()) {
  test.describe(`command slice ${String(index + 1)} in real VS Code`, () => {
    let session: VscodeSession;
    let extensionsDirectory: string;

    test.beforeAll(async () => {
      extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-every-ext-'));
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

    for (const title of slice) {
      test(`${title} runs without reporting a failure`, async () => {
        await session.window.keyboard.press('Escape');
        await session.window.keyboard.press('Control+Shift+P');
        const input = session.window.locator('.quick-input-widget input');
        await input.waitFor({ state: 'visible', timeout: 30_000 });
        await input.fill(`>${title}`);
        await session.window.waitForTimeout(700);

        // The palette must still be offering the command. A row count of zero
        // means the extension host died earlier in the slice, and running
        // Enter against an empty palette would report a false pass.
        const rows = session.window.locator('.quick-input-list .monaco-list-row');
        expect(await rows.count()).toBeGreaterThan(0);

        await session.window.keyboard.press('Enter');
        await session.window.waitForTimeout(2_500);

        const toasts = await session.window
          .locator('.notifications-toasts')
          .allTextContents()
          .catch(() => []);
        expect(toasts.join(' ')).not.toMatch(
          /unexpected error|failed to activate|cannot read|is not a function/iu,
        );
        await session.window.keyboard.press('Escape');
      });
    }
  });
}
