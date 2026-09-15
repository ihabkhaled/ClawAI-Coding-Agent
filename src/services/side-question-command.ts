import * as vscode from 'vscode';

import { renderSideAnswer } from '../core/side-question';

import type { SideQuestionDependencies } from './side-question.types';

/**
 * Asks something without adding it to the conversation.
 *
 * The question goes to a separate thread, created archived so it never appears
 * in the history list, and the answer opens as a document rather than a
 * message. Both halves matter: a side question that landed in the transcript
 * would change what the agent carries forward, which is the one thing the user
 * was avoiding by asking it this way.
 *
 * It deliberately carries none of the conversation's context. There is no way
 * to give it that context without writing into the thread, which is the thing
 * being avoided — so the honest behaviour is a clean question, and the answer
 * says as much at the bottom.
 */
export async function askSideQuestion(dependencies: SideQuestionDependencies): Promise<void> {
  const question = await vscode.window.showInputBox({
    title: vscode.l10n.t('Ask a side question'),
    prompt: vscode.l10n.t('Answered outside the conversation, without its context.'),
  });
  if (question === undefined || question.trim().length === 0) return;
  const content = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Asking…') },
    async () => dependencies.ask(await dependencies.scratchThreadId(), question.trim()),
  );
  await dependencies.openAnswer(renderSideAnswer({ question: question.trim(), content }));
}
