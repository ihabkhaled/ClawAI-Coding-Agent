import * as vscode from 'vscode';

import { archivedThreads } from '../core/thread-list';
import { isThreadRename, normalizeThreadTitle } from '../core/thread-title';

import type { ThreadOrganizationDependencies } from './thread-organization.types';
import type { ChatThread } from '../backend/contracts';

/** How a thread reads in a picker: its name, or the fact it has none. */
function label(thread: ChatThread): string {
  const title = thread.title?.trim();
  return title === undefined || title.length === 0 ? vscode.l10n.t('Untitled conversation') : title;
}

async function pickThread(
  threads: readonly ChatThread[],
  title: string,
  empty: string,
): Promise<ChatThread | undefined> {
  if (threads.length === 0) {
    await vscode.window.showInformationMessage(empty);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    threads.map((thread) => ({ label: label(thread), thread })),
    { title, matchOnDescription: true },
  );
  return picked?.thread;
}

/**
 * Renames a conversation.
 *
 * A derived first-sentence title is a guess made before the conversation had
 * happened. It is usually close enough to find a thread again the same day and
 * rarely close enough a week later, which is exactly when a history list stops
 * being useful. The endpoint to fix that already existed.
 */
export async function renameChat(dependencies: ThreadOrganizationDependencies): Promise<void> {
  const thread = await pickThread(
    dependencies.state().snapshot.history,
    vscode.l10n.t('Rename conversation'),
    vscode.l10n.t('There are no conversations to rename.'),
  );
  if (thread === undefined) return;
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Rename conversation'),
    value: thread.title ?? '',
    prompt: vscode.l10n.t('A name you will recognise a week from now.'),
  });
  if (typed === undefined) return;
  const title = normalizeThreadTitle(typed);
  // Clearing a name is not a rename the contract can express: the field takes
  // a string, and sending an empty one would name the thread the empty string.
  if (title === undefined) {
    await vscode.window.showInformationMessage(vscode.l10n.t('A conversation needs a name.'));
    return;
  }
  if (!isThreadRename(thread.title, title)) return;
  await dependencies.backend().updateThread(thread.id, { title });
  await dependencies.refreshHistory();
}

/** Puts a conversation away, which is the only way a history list stays short. */
export async function archiveChat(dependencies: ThreadOrganizationDependencies): Promise<void> {
  const thread = await pickThread(
    dependencies.state().snapshot.history.filter((entry) => entry.isArchived !== true),
    vscode.l10n.t('Archive conversation'),
    vscode.l10n.t('There are no conversations to archive.'),
  );
  if (thread === undefined) return;
  await dependencies.backend().updateThread(thread.id, { isArchived: true });
  await dependencies.refreshHistory();
}

/**
 * Brings an archived conversation back.
 *
 * Without this, archiving is a trapdoor rather than a filing cabinet, and a
 * user who is not sure they are done with a thread will keep it in the list
 * forever instead of risking it.
 */
export async function browseArchivedChats(
  dependencies: ThreadOrganizationDependencies,
): Promise<void> {
  const thread = await pickThread(
    archivedThreads(dependencies.state().snapshot.history),
    vscode.l10n.t('Restore archived conversation'),
    vscode.l10n.t('No conversations are archived.'),
  );
  if (thread === undefined) return;
  await dependencies.backend().updateThread(thread.id, { isArchived: false });
  await dependencies.refreshHistory();
}
