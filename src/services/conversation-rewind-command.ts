import * as vscode from 'vscode';

import {
  checkpointAt,
  chronological,
  messagePreview,
  newestAnchor,
} from '../core/conversation-rewind';

import type { ConversationRewindDependencies } from './conversation-rewind-command.types';
import type { Checkpoint } from '../core/checkpoint.types';
import type {
  ConversationAnchor,
  RewindRequest,
  RewindScope,
} from '../core/conversation-rewind.types';

function resolveThread(
  dependencies: ConversationRewindDependencies,
  request: RewindRequest,
): string | undefined {
  return request.sessionId === undefined
    ? dependencies.activeThreadId()
    : dependencies.threadForSession(request.sessionId);
}

async function pickMessage(
  dependencies: ConversationRewindDependencies,
  threadId: string,
): Promise<string | undefined> {
  const messages = chronological(await dependencies.listMessages(threadId)).reverse();
  if (messages.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('This conversation has no messages to rewind to.'),
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    messages.map((message) => ({
      label: messagePreview(message.content),
      description: message.role === 'USER' ? vscode.l10n.t('You') : vscode.l10n.t('Assistant'),
      messageId: message.id,
    })),
    { title: vscode.l10n.t('Rewind to which message?') },
  );
  return picked?.messageId;
}

/**
 * Asks before deleting. A rewind cannot be undone on the server, so the modal
 * is the only chance to change one's mind; the code option appears only when a
 * checkpoint was taken at exactly this turn, because restoring some other
 * point's files beside this conversation would pair two different moments.
 */
async function confirmRewind(checkpoint: Checkpoint | undefined): Promise<RewindScope | undefined> {
  const conversationOnly = vscode.l10n.t('Rewind Conversation');
  const both = vscode.l10n.t('Rewind Conversation and Code');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Rewind to this message? Every later message in this conversation will be deleted. This cannot be undone.',
    ),
    { modal: true },
    ...(checkpoint === undefined ? [conversationOnly] : [conversationOnly, both]),
  );
  if (choice === both) return 'both';
  return choice === conversationOnly ? 'conversation' : undefined;
}

/**
 * Deletes every message after the anchor and redraws the panels showing it.
 *
 * Refused while a reply is still streaming into the thread: the reply would be
 * saved after the cut and reappear below a turn the user just rewound past.
 */
export async function rewindConversationTo(
  dependencies: ConversationRewindDependencies,
  anchor: ConversationAnchor,
): Promise<boolean> {
  if (dependencies.isThreadBusy(anchor.threadId)) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('Wait for the current reply to finish before rewinding.'),
    );
    return false;
  }
  const result = await dependencies.rewindThread(anchor.threadId, anchor.messageId);
  await dependencies.reloadThread(anchor.threadId);
  await vscode.window.showInformationMessage(
    vscode.l10n.t(
      'Conversation rewound. {0} later messages were removed.',
      String(result.removedCount),
    ),
  );
  return true;
}

/**
 * Rewinds a conversation to one message: from the "Rewind to here" action on a
 * turn, which names the message, or from the palette, which asks for one.
 *
 * Code goes first when both are chosen. The file restore re-checks every file
 * and throws when one changed underneath it; the conversation is then left as
 * it was rather than rewound beside code that was not put back.
 */
export async function rewindConversation(
  dependencies: ConversationRewindDependencies,
  request: RewindRequest = {},
): Promise<void> {
  const threadId = resolveThread(dependencies, request);
  if (threadId === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Open a conversation to rewind first.'),
    );
    return;
  }
  const messageId = request.messageId ?? (await pickMessage(dependencies, threadId));
  if (messageId === undefined) return;
  const anchor = { threadId, messageId };
  const checkpoint = checkpointAt(dependencies.checkpoints(), anchor);
  const scope = await confirmRewind(checkpoint);
  if (scope === undefined) return;
  if (scope === 'both' && checkpoint !== undefined) await dependencies.restoreCode(checkpoint);
  await rewindConversationTo(dependencies, anchor);
}

/**
 * What a restore should put back, for a checkpoint that remembers where its
 * conversation stood. A checkpoint without an anchor restores code, as it
 * always has, without asking.
 */
export async function chooseRestoreScope(checkpoint: Checkpoint): Promise<RewindScope | undefined> {
  if (checkpoint.conversation === undefined) return 'code';
  const picked = await vscode.window.showQuickPick(
    [
      { label: vscode.l10n.t('Restore code only'), scope: 'code' as const },
      { label: vscode.l10n.t('Restore code and conversation'), scope: 'both' as const },
      { label: vscode.l10n.t('Rewind conversation only'), scope: 'conversation' as const },
    ],
    { title: vscode.l10n.t('What should this checkpoint restore?') },
  );
  return picked?.scope;
}

/**
 * The conversation point a new checkpoint records, or nothing.
 *
 * A checkpoint is about files; failing to read the conversation must not stop
 * one being taken, so any failure here just leaves it unanchored.
 */
export async function captureConversationAnchor(
  dependencies: Pick<ConversationRewindDependencies, 'activeThreadId' | 'listMessages'>,
): Promise<ConversationAnchor | undefined> {
  const threadId = dependencies.activeThreadId();
  if (threadId === undefined) return undefined;
  try {
    return newestAnchor(threadId, await dependencies.listMessages(threadId));
  } catch {
    return undefined;
  }
}
