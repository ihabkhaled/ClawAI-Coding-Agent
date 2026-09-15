import * as vscode from 'vscode';

import type { ContextFreshnessPort } from '../services/context-freshness-service.types';
import type { WorkspaceScopeService } from '../services/workspace-scope-service';

/**
 * Reads a collected range again, through VS Code rather than the disk.
 *
 * `openTextDocument` sees unsaved editor content as well as the file, which is
 * the right answer here: the question is whether what the model was given still
 * matches what the file says now, and an edit sitting in an editor is already a
 * difference the reader can see.
 *
 * Every failure returns nothing rather than throwing. A range that cannot be
 * read is reported as gone, which is what a deleted file, an unreadable one and
 * a file that shrank past those lines all amount to for a reader.
 */
export class VscodeContextRangeReader implements ContextFreshnessPort {
  constructor(private readonly scope: WorkspaceScopeService) {}

  async readRange(path: string, startLine?: number, endLine?: number): Promise<string | undefined> {
    const folder = this.scope.selectedFolder();
    try {
      const uri = vscode.Uri.joinPath(folder.uri, path);
      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      if (startLine === undefined || endLine === undefined) {
        return text;
      }
      const lines = text.split(/\r?\n/u);
      if (startLine > lines.length) {
        return undefined;
      }
      return lines.slice(startLine - 1, Math.min(endLine, lines.length)).join('\n');
    } catch {
      return undefined;
    }
  }
}
