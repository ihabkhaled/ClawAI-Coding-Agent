import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import {
  MAX_CHECKPOINT_BYTES,
  checkpointBytes,
  checkpointLabelSchema,
  dedupeCheckpointFiles,
} from '../core/checkpoint';

import type { CheckpointDependencies } from './checkpoint-command.types';

/**
 * Names the current state of every file the agent has changed this session.
 *
 * Only files the agent touched. A checkpoint of the whole workspace would be a
 * backup tool, which this is not and should not become; the point is to be
 * able to get back to the moment before the agent went in a direction you did
 * not like.
 */
export async function createCheckpoint(dependencies: CheckpointDependencies): Promise<void> {
  const touched = dedupeCheckpointFiles(await dependencies.touchedFiles());
  if (touched.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('The agent has not changed any files yet, so there is nothing to checkpoint.'),
    );
    return;
  }
  const bytes = checkpointBytes(touched);
  if (bytes > MAX_CHECKPOINT_BYTES) {
    await vscode.window.showWarningMessage(
      vscode.l10n.t('These changes are too large to checkpoint.'),
    );
    return;
  }
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Name this checkpoint'),
    prompt: vscode.l10n.t('{0} files will be remembered as they are now.', String(touched.length)),
  });
  if (typed === undefined) return;
  const label = checkpointLabelSchema.safeParse(typed).data;
  if (label === undefined) return;
  await dependencies.save({ id: randomUUID(), label, createdAt: Date.now(), files: touched });
}

/**
 * Puts the files back the way a checkpoint remembers them.
 *
 * Restoring goes through the ordinary file transaction, so it is previewed,
 * approved and itself undoable. A restore that could not be undone would make
 * the safety feature the most dangerous button in the extension.
 */
export async function restoreCheckpoint(dependencies: CheckpointDependencies): Promise<void> {
  const checkpoints = dependencies.checkpoints();
  if (checkpoints.length === 0) {
    await vscode.window.showInformationMessage(vscode.l10n.t('There are no checkpoints yet.'));
    return;
  }
  const picked = await vscode.window.showQuickPick(
    checkpoints.map((checkpoint) => ({
      label: checkpoint.label,
      description: new Date(checkpoint.createdAt).toLocaleString(),
      detail: vscode.l10n.t('{0} files', String(checkpoint.files.length)),
      checkpoint,
    })),
    { title: vscode.l10n.t('Restore which checkpoint?') },
  );
  if (picked === undefined) return;
  await dependencies.restore(picked.checkpoint);
}
