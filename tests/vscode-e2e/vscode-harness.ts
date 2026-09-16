import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { env } from 'node:process';

import { chromium } from 'playwright';

import { VSCODE_CANDIDATE_PATHS, VSCODE_LAUNCH_ARGUMENTS } from './vscode-harness.constants';

import type { Browser, Page } from 'playwright';
import type { ChildProcess } from 'node:child_process';

/**
 * Launches the real VS Code with the real packaged extension.
 *
 * Every other browser lane in this repository drives a fixture page that
 * imitates the webview. That proves the markup behaves and says nothing about
 * the extension: a command that is never registered, a view whose provider
 * throws on activation, or a webview that fails its own CSP all look identical
 * to a passing fixture.
 *
 * This launches the editor as a user would, with the VSIX installed into a
 * throwaway profile, and asks the running instance questions. It is slower and
 * it is the only lane that can answer them.
 */
export interface VscodeSession {
  readonly browser: Browser;
  readonly process: ChildProcess;
  readonly window: Page;
  readonly workspace: string;
  readonly close: () => Promise<void>;
}

export function vscodeExecutable(): string {
  const configured = env.CLAW_VSCODE_PATH;
  if (configured !== undefined && existsSync(configured)) return configured;
  const found = VSCODE_CANDIDATE_PATHS.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      'No VS Code executable found. Set CLAW_VSCODE_PATH to the Code binary to run this lane.',
    );
  }
  return found;
}

/**
 * Installs the packaged VSIX into a disposable extensions directory.
 *
 * The artifact is installed rather than the source tree pointed at, because the
 * question this lane exists to answer is whether what ships works — and the two
 * differ in exactly the ways that bite: what `.vscodeignore` dropped, and
 * whether `dist/` was rebuilt.
 */
export function installExtension(vsix: string, extensionsDirectory: string): void {
  // Not `shell: true`: the CLI lives under "Microsoft VS Code", and a shell
  // splits that path at the space before anything else can go wrong. The .cmd
  // wrapper is what Windows needs, and execFileSync quotes it correctly when no
  // shell is involved.
  const directory = path.dirname(vscodeExecutable());
  const candidates = [path.join(directory, 'bin', 'code.cmd'), path.join(directory, 'bin', 'code')];
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (cli === undefined) throw new Error(`No VS Code CLI beside ${directory}`);
  const cliArguments = ['--extensions-dir', extensionsDirectory, '--install-extension', vsix];

  // Node refuses to spawn a .cmd without a shell, and a shell splits the path
  // at the space in "Microsoft VS Code". Naming the interpreter avoids both:
  // cmd.exe receives the script as one argument and quotes it itself.
  if (cli.endsWith('.cmd')) {
    // cmd.exe keeps the outer pair of quotes and strips nothing else, so the
    // whole command is handed over pre-quoted and Node is told not to re-quote
    // it. Anything less loses the space in "Microsoft VS Code".
    const quoted = [cli, ...cliArguments].map((part) => `"${part}"`).join(' ');
    execFileSync(env.ComSpec ?? 'cmd.exe', [`/d /s /c "${quoted}"`], {
      stdio: 'pipe',
      windowsVerbatimArguments: true,
    });
    return;
  }
  execFileSync(cli, cliArguments, { stdio: 'pipe' });
}

/** A scratch project with enough in it for the agent to have something to read. */
export function seedWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), 'claw-e2e-ws-'));
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(
    path.join(workspace, 'README.md'),
    '# Fixture project\n\nA scratch project used by the VS Code end-to-end lane.\n',
    'utf8',
  );
  writeFileSync(
    path.join(workspace, 'src', 'app.ts'),
    'export function add(left: number, right: number): number {\n  return left + right;\n}\n',
    'utf8',
  );
  return workspace;
}

export async function launchVscode(options: {
  readonly extensionsDirectory: string;
  readonly workspace: string;
}): Promise<VscodeSession> {
  const userData = mkdtempSync(path.join(tmpdir(), 'claw-e2e-user-'));
  const port = 9_000 + Math.floor(Math.random() * 1_000);

  // Playwright's Electron launcher cannot bootstrap VS Code: it expects to own
  // the main process, and a packaged editor already does. Opening a debugging
  // port and attaching over CDP drives the same window without that fight, and
  // is how VS Code itself is automated.
  const child = spawn(
    vscodeExecutable(),
    [
      ...VSCODE_LAUNCH_ARGUMENTS,
      `--remote-debugging-port=${String(port)}`,
      `--extensions-dir=${options.extensionsDirectory}`,
      `--user-data-dir=${userData}`,
      options.workspace,
    ],
    { stdio: 'ignore', detached: false },
  );

  const browser = await connectWhenReady(port);
  const window = await workbenchPage(browser);

  return {
    browser,
    process: child,
    window,
    workspace: options.workspace,
    close: async () => {
      await browser.close().catch(() => undefined);
      child.kill();
      rmSync(userData, { force: true, recursive: true });
    },
  };
}

/**
 * Waits for the debugging port to answer, rather than sleeping a fixed amount.
 *
 * A cold editor start varies by tens of seconds between a warm and a cold disk
 * cache, so a fixed wait is either flaky or slow. Retrying the connection is
 * neither.
 */
async function connectWhenReady(port: number): Promise<Browser> {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`VS Code never opened a debugging port: ${String(lastError)}`);
}

/**
 * The workbench window, not whatever page answered first.
 *
 * An editor start exposes several targets — shared process, extension host,
 * issue reporter — and only one of them is the window a user sees.
 */
async function workbenchPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if ((await page.locator('.monaco-workbench').count()) > 0) return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('No VS Code workbench window appeared');
}

/**
 * Runs a command through the palette, the way a user reaches it.
 *
 * Deliberately not `executeCommand` through the extension host: that proves the
 * handler runs and skips everything between the user and the handler, which is
 * where "command not found" lives.
 */
export async function runCommandFromPalette(window: Page, title: string): Promise<void> {
  await window.keyboard.press('Control+Shift+P');
  const input = window.locator('.quick-input-widget input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(`>${title}`);
  await window.waitForTimeout(600);
  await window.keyboard.press('Enter');
}

/** Whether the palette currently offers a command matching this label. */
export async function paletteOffers(window: Page, title: string): Promise<boolean> {
  await window.keyboard.press('Control+Shift+P');
  const input = window.locator('.quick-input-widget input');
  await input.waitFor({ state: 'visible', timeout: 30_000 });
  await input.fill(`>${title}`);
  await window.waitForTimeout(600);
  const rows = window.locator('.quick-input-list .monaco-list-row');
  const count = await rows.count();
  let offered = false;
  for (let index = 0; index < count; index += 1) {
    const text = (await rows.nth(index).innerText()).toLowerCase();
    if (text.includes(title.toLowerCase())) offered = true;
  }
  await window.keyboard.press('Escape');
  return offered;
}
