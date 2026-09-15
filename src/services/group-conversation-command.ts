import * as vscode from 'vscode';

import {
  assignThreadToGroup,
  existingGroupNames,
  threadGroupNameSchema,
} from '../core/thread-group';

import type { GroupChoice, GroupConversationDependencies } from './group-conversation.types';
import type { ChatThread } from '../backend/contracts';

function threadLabel(thread: ChatThread): string {
  const title = thread.title?.trim();
  return title === undefined || title.length === 0 ? vscode.l10n.t('Untitled conversation') : title;
}

/**
 * Asks which group, offering the ones that exist plus "new" and "none".
 *
 * "None" is in the same list rather than behind a second command, because
 * "which group is this in" is a single question whose answer includes none.
 * Splitting it would make taking something out feel like a different kind of
 * act than moving it.
 */
async function pickGroup(names: readonly string[]): Promise<GroupChoice | undefined> {
  const items: { label: string; choice: GroupChoice }[] = [
    { label: vscode.l10n.t('New group…'), choice: { kind: 'new' } },
    ...names.map((name) => ({ label: name, choice: { kind: 'existing' as const, name } })),
    { label: vscode.l10n.t('No group'), choice: { kind: 'none' } },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Which group?'),
  });
  return picked?.choice;
}

/** Files a conversation into a group, or takes it out of one. */
export async function groupConversation(
  dependencies: GroupConversationDependencies,
): Promise<void> {
  const threads = dependencies.threads();
  if (threads.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('There are no conversations to group.'),
    );
    return;
  }
  const assignments = dependencies.assignments();
  const pickedThread = await vscode.window.showQuickPick(
    threads.map((thread) => ({
      label: threadLabel(thread),
      description: assignments[thread.id] ?? '',
      threadId: thread.id,
    })),
    { title: vscode.l10n.t('Which conversation?') },
  );
  if (pickedThread === undefined) return;
  const choice = await pickGroup(existingGroupNames(assignments));
  if (choice === undefined) return;
  const group = await resolveGroupName(choice);
  if (choice.kind !== 'none' && group === undefined) return;
  await dependencies.save(assignThreadToGroup(assignments, threads, pickedThread.threadId, group));
}

async function resolveGroupName(choice: GroupChoice): Promise<string | undefined> {
  if (choice.kind === 'none') return undefined;
  if (choice.kind === 'existing') return choice.name;
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Name the group'),
    prompt: vscode.l10n.t('A short label you will recognise in the sidebar.'),
  });
  if (typed === undefined) return undefined;
  return threadGroupNameSchema.safeParse(typed).data;
}
