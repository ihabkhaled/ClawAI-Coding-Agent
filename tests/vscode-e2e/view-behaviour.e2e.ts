import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { installExtension, launchVscode, seedWorkspace } from './vscode-harness';

import type { VscodeSession } from './vscode-harness';
import type { Locator } from 'playwright';

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const VSIX = path.join('builds', `clawai-coding-agent-${manifest.version}.vsix`);

let session: VscodeSession;
let extensionsDirectory: string;

/**
 * The pane carrying a given view title.
 *
 * Views are addressed by the title a user reads rather than by index: the order
 * of the container is a manifest detail that may change, and a positional
 * lookup would silently start asserting about a different view.
 */
function pane(title: string): Locator {
  return session.window.locator('.sidebar .pane').filter({
    has: session.window.locator('.pane-header', { hasText: title }),
  });
}

/**
 * The text a pane's body renders, with the injected list stylesheet removed.
 *
 * A Monaco list writes a `<style>` block into its own body, so `textContent`
 * returns the CSS after the visible rows. Left in, every assertion about what a
 * view says could pass on a stylesheet rule instead.
 */
async function bodyText(title: string): Promise<string> {
  const raw = (await pane(title).locator('.pane-body').textContent({ timeout: 30_000 })) ?? '';
  const [visible = ''] = raw.split('.monaco-list');
  return visible.replace(/\s+/gu, ' ').trim();
}

test.beforeAll(async () => {
  extensionsDirectory = mkdtempSync(path.join(tmpdir(), 'claw-view-ext-'));
  await installExtension(VSIX, extensionsDirectory);
  session = await launchVscode({ extensionsDirectory, workspace: seedWorkspace() });
  await session.window.locator('.activitybar [aria-label*="ClawAI" i]').first().click();
  await expect(pane('Getting Started').locator('.monaco-list-row').first()).toBeVisible({
    timeout: 90_000,
  });
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
 * What each view actually renders in a running editor.
 *
 * A tree data provider that throws renders an empty pane and registers no
 * error, so every test that only checks a view exists passes over a dead one.
 * These assert on the content, which is the part that can go missing.
 */
test.describe('view contents in real VS Code', () => {
  test('the container offers every contributed view', async () => {
    await expect(session.window.locator('.sidebar .pane')).toHaveCount(9);
  });

  test('Getting Started lists the steps a first run must take', async () => {
    const text = await bodyText('Getting Started');

    // Each is a distinct step a first run cannot skip. A provider that returns
    // a single generic row would still render, and would tell a user nothing.
    expect(text).toContain('Sign in to ClawAI');
    expect(text).toContain('Open a project folder');
    expect(text).toContain('Trust this workspace');
    expect(text).toContain('Load the model catalog');
  });

  test('Model & Route names the routing mode rather than rendering blank', async () => {
    await expect
      .poll(async () => bodyText('Model & Route'), { timeout: 60_000 })
      .toMatch(/router/iu);
  });

  test('Context explains that nothing has been collected yet', async () => {
    expect(await bodyText('Context')).toMatch(/no context/iu);
  });

  test('History explains that there are no conversations yet', async () => {
    expect(await bodyText('History')).toMatch(/no recent conversations/iu);
  });

  test('Needs You says nothing is waiting rather than showing an empty pane', async () => {
    // An attention view that renders blank is indistinguishable from one that
    // is hiding an approval the run is stalled on.
    expect(await bodyText('Needs You')).toMatch(/nothing is waiting/iu);
  });

  test('Tasks says there are no tasks yet', async () => {
    expect(await bodyText('Tasks')).toMatch(/no tasks/iu);
  });

  test('Findings says nothing has been reported', async () => {
    expect(await bodyText('Findings')).toMatch(/no findings/iu);
  });

  test('Delivered Files says nothing has been delivered', async () => {
    expect(await bodyText('Delivered Files')).toMatch(/no files delivered/iu);
  });

  test('every tree view renders a row, so none of the providers threw', async () => {
    for (const title of [
      'Getting Started',
      'Model & Route',
      'Context',
      'History',
      'Needs You',
      'Tasks',
      'Findings',
      'Delivered Files',
    ]) {
      expect(await pane(title).locator('.monaco-list-row').count()).toBeGreaterThan(0);
    }
  });
});
