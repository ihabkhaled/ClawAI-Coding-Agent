import * as vscode from 'vscode';

import { remoteSessionClient } from '../backend/remote-session-client';
import { isUnsupportedRoute } from '../backend/remote-session-fallback';
import { outcomeOf } from '../core/session-handoff';

import { handOffToThread } from './session-handoff';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type { CloudTask } from '../backend/remote-session-contracts';
import type { RepositoryRef } from '../core/repository-ref.types';

/** Stops a command that has not finished. A backend without the route is told so. */
export async function stopSession(
  dependencies: RemoteSessionDependencies,
  taskId: string,
): Promise<boolean> {
  try {
    await remoteSessionClient.cancelCommand(
      dependencies.request(),
      taskId,
      'Stopped from the ClawAI extension',
    );
    await vscode.window.showInformationMessage(vscode.l10n.t('Session {0} was stopped.', taskId));
    return true;
  } catch (error) {
    await vscode.window.showErrorMessage(
      isUnsupportedRoute(error)
        ? vscode.l10n.t('This backend cannot stop a runner session.')
        : vscode.l10n.t('The session could not be stopped. It may already have finished.'),
    );
    return false;
  }
}

/**
 * The next step after a session: hand a finished result to a chat thread, or
 * offer to stop one still running. Returns once the user has chosen.
 */
export async function offerFollowUp(
  dependencies: RemoteSessionDependencies,
  task: CloudTask,
  runnerName: string,
  repositoryRef?: RepositoryRef,
): Promise<void> {
  const openInChat = vscode.l10n.t('Open in Chat');
  const stop = vscode.l10n.t('Stop Session');
  const running = outcomeOf(task) === 'running';
  const message = running
    ? vscode.l10n.t('Session {0} is still running on {1}.', task.id, runnerName)
    : vscode.l10n.t('Session {0} finished with status {1}.', task.id, task.status);
  const choice = await vscode.window.showInformationMessage(
    message,
    ...(running ? [openInChat, stop] : [openInChat]),
  );
  if (choice === openInChat) await handOffToThread(dependencies, task, runnerName, repositoryRef);
  else if (choice === stop) await stopSession(dependencies, task.id);
}
