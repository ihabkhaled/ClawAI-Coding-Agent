import * as vscode from 'vscode';

import { isUnsupportedRoute } from '../backend/remote-session-fallback';
import { buildHandoffSummary } from '../core/session-handoff';

import { HANDOFF_THREAD_CHOICES } from './session-handoff.constants';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type { CloudTask } from '../backend/remote-session-contracts';
import type { RepositoryRef } from '../core/repository-ref.types';

interface ThreadChoice extends vscode.QuickPickItem {
  readonly threadId: string | undefined;
}

function titleOf(title: string | null | undefined): string {
  const trimmed = title?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : vscode.l10n.t('Untitled conversation');
}

async function chooseThread(
  dependencies: RemoteSessionDependencies,
): Promise<ThreadChoice | undefined> {
  const choices: ThreadChoice[] = [
    { label: vscode.l10n.t('New conversation'), threadId: undefined },
    ...dependencies
      .agentHistory()
      .slice(0, HANDOFF_THREAD_CHOICES)
      .map((thread) => ({
        label: titleOf(thread.title),
        threadId: thread.id,
      })),
  ];
  return vscode.window.showQuickPick(choices, {
    placeHolder: vscode.l10n.t('Continue this session in which conversation?'),
  });
}

/**
 * Hands a runner session's result to a chat thread: a redacted summary is
 * posted as the next message, so the conversation continues with the result in
 * context. Returns whether a thread received it.
 */
export async function handOffToThread(
  dependencies: RemoteSessionDependencies,
  task: CloudTask,
  runnerName: string,
  repositoryRef?: RepositoryRef,
): Promise<boolean> {
  const choice = await chooseThread(dependencies);
  if (choice === undefined) return false;
  const backend = dependencies.backend();
  try {
    const threadId =
      choice.threadId ??
      (
        await backend.createThread({
          title: vscode.l10n.t('Runner session {0}', task.id),
          routingMode: 'AUTO',
          ...(repositoryRef === undefined ? {} : { repositoryRef }),
        })
      ).id;
    await backend.sendMessage({
      threadId,
      content: buildHandoffSummary({ task, runnerName }),
      routingMode: 'AUTO',
    });
    await dependencies.revealThread(threadId, choice.label);
    return true;
  } catch (error) {
    const message = isUnsupportedRoute(error)
      ? vscode.l10n.t('This backend cannot take the session into a conversation yet.')
      : vscode.l10n.t('The session could not be added to the conversation.');
    await vscode.window.showErrorMessage(message);
    return false;
  }
}
