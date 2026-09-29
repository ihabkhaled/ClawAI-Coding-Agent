import * as vscode from 'vscode';

import { selectedModelAcceptsImages } from '../core/model-vision';
import { BROWSER_LIVE_PAGES } from '../infrastructure/browser-live-pages.constants';
import { capturePlaywrightPage } from '../infrastructure/playwright-browser-state-capture';

import { attachBrowserState } from './attach-browser-command';
import { attachTerminalOutput } from './attach-terminal-command';

import type { BrowserScreenshotAttachment } from '../core/browser-reference.types';
import type { ExtensionSnapshot } from '../core/extension-state';
import type { VscodeTerminalTracker } from '../infrastructure/vscode-terminal-capture';

/** The composer surface a reference lands in. */
export interface ReferenceComposer {
  appendToComposer(text: string): Promise<void>;
  attachToComposer(attachment: BrowserScreenshotAttachment): Promise<void>;
}

/**
 * The commands that put evidence the user is looking at into the composer:
 * a terminal's output and the agent browser's newest open page.
 */
export function registerComposerReferenceCommands(
  snapshot: () => ExtensionSnapshot,
  composer: ReferenceComposer,
  terminals: VscodeTerminalTracker,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('clawAI.attachTerminalOutput', () =>
      attachTerminalOutput({
        terminals: () => vscode.window.terminals,
        capture: (terminal) => terminals.capture(terminal),
        insert: (block) => composer.appendToComposer(block),
      }),
    ),
    vscode.commands.registerCommand('clawAI.attachBrowserState', () =>
      attachBrowserState({
        capture: async (includeScreenshot) => {
          const page = BROWSER_LIVE_PAGES.latest();
          return page === undefined ? undefined : capturePlaywrightPage(page, includeScreenshot);
        },
        acceptsImages: () => selectedModelAcceptsImages(snapshot()),
        insert: (block) => composer.appendToComposer(block),
        attach: (attachment) => composer.attachToComposer(attachment),
        now: () => new Date(),
      }),
    ),
  ];
}
