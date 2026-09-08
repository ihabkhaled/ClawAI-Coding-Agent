import * as vscode from 'vscode';

import { TRANSCRIPT_EXPORT_FORMATS } from '../core/transcript-export';

import type { ConversationSessionService } from './conversation-session-service';
import type { ExtensionState } from '../core/extension-state';
import type { TranscriptExportFormat } from '../core/transcript-export';

interface ExportDependencies {
  readonly conversations: ConversationSessionService;
  readonly state: ExtensionState;
}

const formatLabels: Readonly<Record<TranscriptExportFormat, string>> = {
  markdown: 'Markdown',
  json: 'JSON',
};

/**
 * Writes one conversation to a file the user chooses.
 *
 * The run journal and the evidence bundle already export, but both describe a
 * run rather than a conversation and both are reachable only as agent tools —
 * there was no way for a person to keep what was said, which is what a support
 * request or a review actually wants.
 *
 * The conversation is picked rather than inferred from focus. There is no
 * active-session concept to infer from, and picking is the better affordance
 * anyway: the transcript worth exporting is often an earlier one.
 *
 * The save dialog is the whole permission model. Nothing is written until the
 * user names the destination, so this needs no approval of its own and touches
 * no workspace path policy.
 */
export async function exportTranscript(dependencies: ExportDependencies): Promise<void> {
  const threads = dependencies.state.snapshot.history;
  if (threads.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('There are no ClawAI conversations to export yet.'),
    );
    return;
  }

  const untitled = vscode.l10n.t('Untitled conversation');
  const chosen = await vscode.window.showQuickPick(
    threads.map((thread) => ({
      label: thread.title?.trim() ?? untitled,
      threadId: thread.id,
    })),
    { placeHolder: vscode.l10n.t('Choose a conversation to export') },
  );
  if (chosen === undefined) return;

  const picked = await vscode.window.showQuickPick(
    TRANSCRIPT_EXPORT_FORMATS.map((format) => ({ label: formatLabels[format], format })),
    { placeHolder: vscode.l10n.t('Choose a transcript format') },
  );
  if (picked === undefined) return;

  const { filename, content } = await dependencies.conversations.exportThread(
    chosen.threadId,
    picked.format,
    chosen.label,
  );

  const destination = await vscode.window.showSaveDialog({
    filters: picked.format === 'json' ? { JSON: ['json'] } : { Markdown: ['md'] },
    saveLabel: vscode.l10n.t('Export transcript'),
    // Only the suggested name comes from the conversation, and it has already
    // been reduced to word characters. The directory is the user's choice.
    defaultUri: vscode.Uri.joinPath(defaultDirectory(), filename),
  });
  if (destination === undefined) return;

  await vscode.workspace.fs.writeFile(destination, Buffer.from(content, 'utf8'));
  await vscode.window.showInformationMessage(
    vscode.l10n.t('Transcript exported. Secrets were redacted.'),
  );
}

function defaultDirectory(): vscode.Uri {
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.');
}
