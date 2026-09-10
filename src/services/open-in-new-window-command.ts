import * as vscode from 'vscode';

import { claimHandoff } from '../core/window-handoff';

import type { NewWindowDependencies } from './open-in-new-window.types';

/** Where the pending handoff is written, in storage every window can read. */
export const HANDOFF_KEY = 'clawAI.pendingWindowHandoff';

/**
 * Opens a conversation in a second VS Code window.
 *
 * A webview panel cannot move between windows, so this does not move anything:
 * it opens the same folder in a new window and leaves a note asking that
 * window to reveal the conversation. Two windows on one folder is a supported
 * VS Code arrangement, and it is what the user actually wants — the
 * conversation beside a different set of files.
 *
 * Refuses without a folder rather than opening an empty window: a chat in a
 * window with no workspace can read nothing, which is not what was asked for.
 */
export async function openConversationInNewWindow(
  dependencies: NewWindowDependencies,
): Promise<void> {
  const threadId = dependencies.activeThreadId();
  if (threadId === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Open a conversation before moving it to a new window.'),
    );
    return;
  }
  const folder = dependencies.workspaceFolder();
  if (folder === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Open a folder before opening a conversation in a new window.'),
    );
    return;
  }
  await dependencies.storeHandoff({ threadId, requestedAt: dependencies.now() });
  await dependencies.openFolderInNewWindow(folder);
}

/**
 * Reveals the conversation a previous window asked this one to open.
 *
 * The record is cleared before the conversation opens, not after. Clearing
 * afterwards would leave it behind if opening failed, and the next window
 * would inherit a request nobody made.
 */
export async function claimPendingWindowHandoff(
  dependencies: NewWindowDependencies,
): Promise<void> {
  const stored = dependencies.readHandoff();
  const threadId = claimHandoff(stored, dependencies.now());
  if (stored !== undefined) await dependencies.storeHandoff(undefined);
  if (threadId === undefined) return;
  await dependencies.openThread(threadId);
}
