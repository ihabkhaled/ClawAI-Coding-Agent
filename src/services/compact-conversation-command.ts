import * as vscode from 'vscode';

import { COMPACTION_INSTRUCTION, compactionSeed } from '../core/context-compaction';

import type { CompactConversationDependencies } from './compact-conversation.types';

/**
 * Summarizes the current conversation and continues it in a new one.
 *
 * The summary is produced by the same model the conversation was using, in the
 * conversation itself, and is the last thing that happens there. Asking a
 * different model would summarize a conversation it never saw; asking in a
 * side thread would hide from the user what was written on their behalf.
 *
 * Nothing is destroyed. The original thread stays exactly as it was and stays
 * reachable in history — compaction starts a new conversation, it does not
 * rewrite the old one. That is the difference between a feature a person will
 * use and one they will be afraid of.
 */
export async function compactConversation(
  dependencies: CompactConversationDependencies,
): Promise<void> {
  const threadId = dependencies.activeThreadId();
  if (threadId === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Open a conversation before compacting it.'),
    );
    return;
  }
  if (dependencies.unattended !== true) {
    const confirmed = await vscode.window.showInformationMessage(
      vscode.l10n.t('Summarize this conversation and continue in a new one?'),
      {
        modal: true,
        detail: vscode.l10n.t('The original conversation is kept and stays in your history.'),
      },
      vscode.l10n.t('Summarize and continue'),
    );
    if (confirmed === undefined) return;
  }
  const summary = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Summarizing…') },
    async () => dependencies.summarize(threadId, COMPACTION_INSTRUCTION),
  );
  if (summary.trim().length === 0) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('The summary came back empty, so nothing was changed.'),
    );
    return;
  }
  await dependencies.startContinuation(compactionSeed(summary));
}
