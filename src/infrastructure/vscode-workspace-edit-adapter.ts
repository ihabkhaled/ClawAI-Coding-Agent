import * as vscode from 'vscode';

import type { EditPlan, WorkspaceCommand } from '../core/edit-plan';
import type { EditPreview, WorkspaceEditPort } from '../services/safe-edit-service';
import type { WorkspaceFolderScopePort } from '../services/workspace-scope-service.types';

interface EditBackup {
  plan: EditPlan;
  previews: EditPreview[];
}

export class VscodeWorkspaceEditAdapter implements WorkspaceEditPort {
  private lastBackup: EditBackup | null = null;

  constructor(private readonly scope: WorkspaceFolderScopePort) {}

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

  async execute(
    command: WorkspaceCommand,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | undefined }> {
    if (signal.aborted) {
      throw new Error('ClawAI command execution was cancelled.');
    }
    const folder = this.workspaceFolder();
    const cwd =
      command.cwd === undefined || command.cwd === '.'
        ? folder.uri.fsPath
        : vscode.Uri.joinPath(folder.uri, ...command.cwd.replaceAll('\\', '/').split('/')).fsPath;
    const task = new vscode.Task(
      { type: 'clawai', command: command.command },
      vscode.TaskScope.Workspace,
      `ClawAI: ${command.purpose}`,
      'ClawAI',
      new vscode.ShellExecution(command.command, { cwd }),
    );
    task.presentationOptions = {
      clear: false,
      echo: true,
      focus: false,
      panel: vscode.TaskPanelKind.Dedicated,
      reveal: vscode.TaskRevealKind.Always,
      showReuseMessage: true,
    };
    const execution = await vscode.tasks.executeTask(task);
    return new Promise((resolve, reject) => {
      const ended = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution !== execution) {
          return;
        }
        cleanup();
        resolve({ exitCode: event.exitCode });
      });
      const aborted = (): void => {
        execution.terminate();
        cleanup();
        reject(new Error('ClawAI command execution was cancelled.'));
      };
      const cleanup = (): void => {
        ended.dispose();
        signal.removeEventListener('abort', aborted);
      };
      signal.addEventListener('abort', aborted, { once: true });
    });
  }

  private workspaceFolder(): Pick<vscode.WorkspaceFolder, 'uri'> {
    return this.scope.selectedFolder();
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
