import * as vscode from 'vscode';

import { dropInsertion, resolveDrop } from '../core/attachment-drop';

import type { DropUrisDependencies } from './drop-uris-command.types';

/**
 * Turns files dragged from the editor or the explorer into composer text.
 *
 * Dropping a file from the file tree used to do nothing at all, which reads as
 * a broken feature rather than an absent one — the cursor changes, the drop
 * lands, and the composer is unchanged.
 *
 * A refusal is told to the user rather than swallowed. A dragged file from
 * outside the workspace is a reasonable thing to try, and silence would leave
 * someone dragging the same file again.
 */
export async function dropUris(
  dependencies: DropUrisDependencies,
  uriList: string,
  shiftKey: boolean,
): Promise<void> {
  const root = dependencies.workspaceRoot();
  if (root === undefined) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Open a folder before dropping files into the composer.'),
    );
    return;
  }
  const resolution = resolveDrop({ uriList, hasFiles: false, shiftKey }, root);
  const text = dropInsertion(resolution);
  if (text.length === 0) {
    await vscode.window.showInformationMessage(
      vscode.l10n.t('Only files inside the open folder can be dropped into the composer.'),
    );
    return;
  }
  await dependencies.appendToComposer(text);
}
