import * as vscode from 'vscode';

import { browserReferenceBlock, browserScreenshotAttachment } from '../core/browser-reference';

import type { AttachBrowserDependencies } from './attach-browser.types';

/**
 * Puts the agent browser's current page into the composer: address, title,
 * selected and visible text, and — when asked and the model can see — a
 * screenshot as an ordinary image attachment.
 *
 * Into the composer, not sent: the user is gathering evidence for a question
 * they have not written yet. The screenshot rides the same attachment path as a
 * picked file, so it is validated, downscaled and uploaded the same way.
 */
export async function attachBrowserState(dependencies: AttachBrowserDependencies): Promise<void> {
  const includeScreenshot = await askForScreenshot(dependencies.acceptsImages());
  if (includeScreenshot === undefined) return;
  const capture = await dependencies.capture(includeScreenshot).catch(() => null);
  if (capture === null) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('The agent browser page could not be read.'),
    );
    return;
  }
  if (capture === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('The agent has no open browser page to attach.'),
    );
    return;
  }
  await dependencies.insert(browserReferenceBlock(capture));
  if (!includeScreenshot) return;
  const attachment = browserScreenshotAttachment(capture.screenshot, dependencies.now());
  if (attachment === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('The page text was attached; the screenshot was too large to attach.'),
    );
    return;
  }
  await dependencies.attach(attachment);
}

/** `undefined` when the user dismissed the choice. */
async function askForScreenshot(acceptsImages: boolean): Promise<boolean | undefined> {
  if (!acceptsImages) return false;
  const withScreenshot = vscode.l10n.t('Page text and screenshot');
  const picked = await vscode.window.showQuickPick(
    [vscode.l10n.t('Page text only'), withScreenshot],
    { title: vscode.l10n.t('Attach the agent browser page') },
  );
  if (picked === undefined) return undefined;
  return picked === withScreenshot;
}
