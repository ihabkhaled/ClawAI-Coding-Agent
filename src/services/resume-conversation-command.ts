import * as vscode from 'vscode';

import { remoteSessionClient } from '../backend/remote-session-client';
import { isRunActiveElsewhere } from '../core/resume-readiness';
import { threadSurfaceOf } from '../core/thread-source';

import {
  RESUME_PROBE_MESSAGES,
  RESUME_WEB_THREAD_LIMIT,
} from './remote-session-commands.constants';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type { ChatThread } from '../backend/contracts';

interface ThreadPick extends vscode.QuickPickItem {
  readonly thread: ChatThread;
}

function titleOf(thread: ChatThread): string {
  const title = thread.title?.trim();
  return title === undefined || title.length === 0 ? vscode.l10n.t('Untitled conversation') : title;
}

function toPick(thread: ChatThread): ThreadPick {
  const surface = threadSurfaceOf(thread.origin);
  return {
    label: titleOf(thread),
    description: surface === 'web' ? vscode.l10n.t('Web') : vscode.l10n.t('Coding agent'),
    thread,
  };
}

/**
 * Agent threads (this window, another machine, or the headless CLI — they all
 * share one origin) followed by the portal's own conversations. A thread seen
 * in both lists is offered once.
 */
async function candidates(dependencies: RemoteSessionDependencies): Promise<ThreadPick[]> {
  const agent = dependencies
    .agentHistory()
    .map((thread) => ({ ...thread, origin: 'CODING_AGENT' }));
  const web = await remoteSessionClient.threadsFrom(
    dependencies.request(),
    'web',
    RESUME_WEB_THREAD_LIMIT,
  );
  const seen = new Set(agent.map((thread) => thread.id));
  return [...agent, ...web.filter((thread) => !seen.has(thread.id))].map(toPick);
}

/**
 * Settles a thread whose last run may still be generating somewhere else.
 * Returns false when the user backs out. Stopping uses the same cancel the
 * other surface's own Stop button uses, so it ends the run for everyone.
 */
async function settleActiveRun(
  dependencies: RemoteSessionDependencies,
  threadId: string,
): Promise<boolean> {
  const messages = await dependencies.backend().listMessages(threadId, RESUME_PROBE_MESSAGES);
  if (!isRunActiveElsewhere(messages)) {
    return true;
  }
  const stop = vscode.l10n.t('Stop That Run');
  const open = vscode.l10n.t('Open Anyway');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t('A reply may still be generating for this conversation on another device.'),
    { modal: true },
    stop,
    open,
  );
  if (choice === stop) {
    await dependencies.backend().cancelStream(threadId);
  }
  return choice !== undefined;
}

/**
 * Opens a conversation that was started on another surface — the web portal,
 * another machine, or the headless CLI — with its full history, so the next
 * prompt continues that same thread.
 */
export async function resumeConversation(dependencies: RemoteSessionDependencies): Promise<void> {
  const picks = await candidates(dependencies);
  const picked = await vscode.window.showQuickPick(picks, {
    placeHolder: vscode.l10n.t('Pick a conversation to resume'),
    matchOnDescription: true,
  });
  if (picked === undefined || !(await settleActiveRun(dependencies, picked.thread.id))) {
    return;
  }
  await dependencies.revealThread(picked.thread.id, picked.label);
}
