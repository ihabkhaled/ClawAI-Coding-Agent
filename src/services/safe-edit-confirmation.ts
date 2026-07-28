import * as vscode from 'vscode';

import type { EditPreview } from './safe-edit-service';
import type { DiffPreviewProvider } from '../views/diff-preview-provider';

export async function confirmSafeEdits(
  diffPreview: DiffPreviewProvider,
  previews: EditPreview[],
  summary: string,
): Promise<boolean> {
  await diffPreview.show(previews);
  const apply = vscode.l10n.t('Apply changes');
  const reject = vscode.l10n.t('Reject');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Review the ClawAI diff previews. Apply {0} proposed file changes for “{1}”?',
      previews.length,
      summary,
    ),
    { modal: true },
    apply,
    reject,
  );
  return choice === apply;
}

export async function offerSafeEditUndo(
  fileCount: number,
  undoEdit: () => Promise<void>,
): Promise<void> {
  const undo = vscode.l10n.t('Undo ClawAI changes');
  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('ClawAI applied {0} file changes.', fileCount),
    undo,
  );
  if (choice === undo) {
    await undoEdit();
  }
}
