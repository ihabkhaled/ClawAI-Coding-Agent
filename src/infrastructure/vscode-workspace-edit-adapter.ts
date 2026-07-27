import * as vscode from 'vscode';

import type { EditPlan } from '../core/edit-plan';
import type { EditPreview, WorkspaceEditPort } from '../services/safe-edit-service';

interface EditBackup {
  plan: EditPlan;
  previews: EditPreview[];
}

export class VscodeWorkspaceEditAdapter implements WorkspaceEditPort {
  private lastBackup: EditBackup | null = null;

  isTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async preview(plan: EditPlan): Promise<EditPreview[]> {
    const folder = this.workspaceFolder();
    const previews: EditPreview[] = [];
    for (const file of plan.files) {
      const uri = vscode.Uri.joinPath(folder.uri, ...file.path.replaceAll('\\', '/').split('/'));
      const before = await this.readOptional(uri);
      previews.push({
        path: file.path,
        before,
        after: file.operation === 'delete' ? null : (file.content ?? null),
      });
    }
    return previews;
  }

  async applyAtomically(plan: EditPlan): Promise<boolean> {
    const folder = this.workspaceFolder();
    const previews = await this.preview(plan);
    const edit = new vscode.WorkspaceEdit();

    for (const file of plan.files) {
      const uri = vscode.Uri.joinPath(folder.uri, ...file.path.replaceAll('\\', '/').split('/'));
      if (file.operation === 'create') {
        edit.createFile(uri, { ignoreIfExists: false, overwrite: false });
        edit.insert(uri, new vscode.Position(0, 0), file.content ?? '');
      } else if (file.operation === 'delete') {
        edit.deleteFile(uri, { ignoreIfNotExists: false, recursive: false });
      } else {
        const document = await vscode.workspace.openTextDocument(uri);
        const lastLine = document.lineAt(document.lineCount - 1);
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          lastLine.rangeIncludingLineBreak.end,
        );
        edit.replace(uri, fullRange, file.content ?? '');
      }
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (applied) {
      this.lastBackup = { plan, previews };
    }
    return applied;
  }

  async undoLast(): Promise<boolean> {
    const backup = this.lastBackup;
    if (backup === null || !this.isTrusted()) {
      return false;
    }
    const inverse: EditPlan = {
      summary: `Undo: ${backup.plan.summary}`,
      files: backup.previews.map((preview) => {
        if (preview.before === null) {
          return { path: preview.path, operation: 'delete' as const };
        }
        return {
          path: preview.path,
          operation: preview.after === null ? ('create' as const) : ('update' as const),
          content: preview.before,
        };
      }),
    };
    const applied = await this.applyAtomically(inverse);
    if (applied) {
      this.lastBackup = null;
    }
    return applied;
  }

  private workspaceFolder(): vscode.WorkspaceFolder {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) {
      throw new Error(vscode.l10n.t('Open a workspace before applying ClawAI changes.'));
    }
    return folder;
  }

  private async readOptional(uri: vscode.Uri): Promise<string | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(bytes);
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return null;
      }
      throw error;
    }
  }
}
