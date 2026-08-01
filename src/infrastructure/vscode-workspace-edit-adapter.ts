import path from 'node:path';

import * as vscode from 'vscode';

import { tokenizeWorkspaceCommand } from '../core/command-tokenizer';
import {
  isRealPathInsideWorkspace,
  resolveCanonicalWorkspacePath,
} from '../core/workspace-file-containment';

import { runBoundedCommand } from './bounded-command-runner';

import type { EditPlan, WorkspaceCommand } from '../core/edit-plan';
import type { ExternalOutputGrant } from '../core/external-output-grants';
import type { CommandExecutionResult } from '../services/agent-run-service.types';
import type { EditPreview, EditReview, WorkspaceEditPort } from '../services/safe-edit-service';
import type { WorkspaceFolderScopePort } from '../services/workspace-scope-service.types';

interface EditBackup {
  plan: EditPlan;
  review: EditReview;
}

interface ExternalOutputGrantResolver {
  resolve(rootKey: string): ExternalOutputGrant | undefined;
}

export class VscodeWorkspaceEditAdapter implements WorkspaceEditPort {
  private lastBackup: EditBackup | null = null;

  constructor(
    private readonly scope: WorkspaceFolderScopePort,
    private readonly externalOutputs?: ExternalOutputGrantResolver,
  ) {}

  isTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async preview(plan: EditPlan): Promise<EditReview> {
    const folder = this.workspaceFolder();
    return this.previewInFolder(plan, folder.uri);
  }

  async applyAtomically(
    plan: EditPlan,
    review: EditReview,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    this.assertReviewMatchesPlan(plan, review);
    const folderUri = vscode.Uri.parse(review.workspaceFolderUri);
    const targetUris = plan.files.map((file, index) =>
      this.targetUri(
        this.reviewedRootUri(file.rootKey, review.previews[index], folderUri),
        file.path,
      ),
    );
    const reviewState = { bufferChanged: false };
    const watchedTargets = new Set(targetUris.map((uri) => uri.toString()));
    const changed = vscode.workspace.onDidChangeTextDocument((event) => {
      if (watchedTargets.has(event.document.uri.toString())) {
        reviewState.bufferChanged = true;
      }
    });
    const edit = new vscode.WorkspaceEdit();

    try {
      await this.assertReviewCurrent(plan, review, folderUri);
      for (const [index, file] of plan.files.entries()) {
        const uri = targetUris[index];
        if (uri === undefined) {
          throw new Error(vscode.l10n.t('The reviewed file changes are no longer available.'));
        }
        if (file.operation === 'create') {
          edit.createFile(uri, {
            contents: new TextEncoder().encode(file.content ?? ''),
            ignoreIfExists: false,
            overwrite: false,
          });
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
      await this.assertReviewCurrent(plan, review, folderUri);
      if (reviewState.bufferChanged) {
        throw this.staleReviewError();
      }
      signal?.throwIfAborted();
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied && plan.files.every((file) => file.rootKey === undefined)) {
        this.lastBackup = { plan, review };
      }
      return applied;
    } finally {
      changed.dispose();
    }
  }

  async undoLast(): Promise<boolean> {
    const backup = this.lastBackup;
    if (backup === null || !this.isTrusted()) {
      return false;
    }
    let selectedFolder: Pick<vscode.WorkspaceFolder, 'uri'>;
    try {
      selectedFolder = this.workspaceFolder();
    } catch {
      return false;
    }
    if (selectedFolder.uri.toString() !== backup.review.workspaceFolderUri) {
      return false;
    }
    const folderUri = vscode.Uri.parse(backup.review.workspaceFolderUri);
    for (const preview of backup.review.previews) {
      const uri = this.targetUri(folderUri, preview.path);
      await this.assertTargetInsideWorkspace(folderUri, uri, preview.after === null);
      if ((await this.readOptional(uri)) !== preview.after) {
        return false;
      }
    }
    const inverse: EditPlan = {
      summary: `Undo: ${backup.plan.summary}`,
      files: backup.review.previews.map((preview) => {
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
    const inverseReview: EditReview = {
      workspaceFolderUri: backup.review.workspaceFolderUri,
      previews: backup.review.previews.map((preview) => ({
        path: preview.path,
        before: preview.after,
        after: preview.before,
      })),
    };
    const applied = await this.applyAtomically(inverse, inverseReview);
    if (applied) {
      this.lastBackup = null;
    }
    return applied;
  }

  async execute(command: WorkspaceCommand, signal: AbortSignal): Promise<CommandExecutionResult> {
    if (signal.aborted) {
      throw new Error('ClawAI command execution was cancelled.');
    }
    const folder = this.workspaceFolder();
    const cwd =
      command.cwd === undefined || command.cwd === '.'
        ? folder.uri.fsPath
        : vscode.Uri.joinPath(folder.uri, ...command.cwd.replaceAll('\\', '/').split('/')).fsPath;
    await this.assertTargetInsideWorkspace(folder.uri, vscode.Uri.file(cwd), false);
    await this.assertCommandPathsInsideWorkspace(folder.uri, command.command);
    signal.throwIfAborted();
    const [executable, ...arguments_] = tokenizeWorkspaceCommand(command.command) ?? [];
    if (executable === undefined) {
      throw new Error('ClawAI could not parse the approved command.');
    }
    if (executable.toLowerCase() !== 'docker') {
      return this.executeVscodeTask(command, cwd, signal);
    }
    return runBoundedCommand(executable, arguments_, cwd, signal);
  }

  private async executeVscodeTask(
    command: WorkspaceCommand,
    cwd: string,
    signal: AbortSignal,
  ): Promise<CommandExecutionResult> {
    const task = new vscode.Task(
      { type: 'clawai', command: command.command },
      vscode.TaskScope.Workspace,
      `ClawAI: ${command.purpose}`,
      'ClawAI',
      new vscode.ShellExecution(command.command, { cwd }),
    );
    const execution = await vscode.tasks.executeTask(task);
    return new Promise((resolve, reject) => {
      const ended = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution !== execution) return;
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
      if (signal.aborted) aborted();
    });
  }

  private workspaceFolder(): Pick<vscode.WorkspaceFolder, 'uri'> {
    return this.scope.selectedFolder();
  }

  private async previewInFolder(plan: EditPlan, folderUri: vscode.Uri): Promise<EditReview> {
    const previews: EditPreview[] = [];
    for (const file of plan.files) {
      const rootUri = this.currentRootUri(file.rootKey, folderUri);
      const uri = this.targetUri(rootUri, file.path);
      await this.assertTargetInsideWorkspace(rootUri, uri, file.operation === 'create');
      const before = await this.readOptional(uri);
      previews.push({
        path: file.path,
        ...(file.rootKey === undefined
          ? {}
          : { rootKey: file.rootKey, rootUri: rootUri.toString() }),
        before,
        after: file.operation === 'delete' ? null : (file.content ?? null),
      });
    }
    return {
      workspaceFolderUri: folderUri.toString(),
      previews,
    };
  }

  private assertReviewMatchesPlan(plan: EditPlan, review: EditReview): void {
    if (
      review.previews.length !== plan.files.length ||
      review.previews.some((preview, index) => {
        const file = plan.files[index];
        if (file === undefined) {
          return true;
        }
        return (
          preview.rootKey !== file.rootKey ||
          preview.path !== file.path ||
          preview.after !== (file.operation === 'delete' ? null : (file.content ?? null))
        );
      })
    ) {
      throw new Error(vscode.l10n.t('The reviewed file changes are no longer available.'));
    }
  }

  private async assertReviewCurrent(
    plan: EditPlan,
    review: EditReview,
    folderUri: vscode.Uri,
  ): Promise<void> {
    for (const [index, file] of plan.files.entries()) {
      const preview = review.previews[index];
      if (preview === undefined) {
        throw new Error(vscode.l10n.t('The reviewed file changes are no longer available.'));
      }
      const rootUri = this.reviewedRootUri(file.rootKey, preview, folderUri);
      const uri = this.targetUri(rootUri, file.path);
      await this.assertTargetInsideWorkspace(rootUri, uri, file.operation === 'create');
      if ((await this.readOptional(uri)) !== preview.before) {
        throw this.staleReviewError();
      }
    }
  }

  private staleReviewError(): Error {
    return new Error(
      vscode.l10n.t(
        'A workspace file changed during review. Review the updated changes before applying.',
      ),
    );
  }

  private targetUri(folderUri: vscode.Uri, relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(folderUri, ...relativePath.replaceAll('\\', '/').split('/'));
  }

  private currentRootUri(rootKey: string | undefined, workspaceUri: vscode.Uri): vscode.Uri {
    if (rootKey === undefined) return workspaceUri;
    const grant = this.externalOutputs?.resolve(rootKey);
    if (grant === undefined) {
      throw new Error(
        vscode.l10n.t('The external output folder permission is no longer available.'),
      );
    }
    return vscode.Uri.parse(grant.uri);
  }

  private reviewedRootUri(
    rootKey: string | undefined,
    preview: EditPreview | undefined,
    workspaceUri: vscode.Uri,
  ): vscode.Uri {
    const current = this.currentRootUri(rootKey, workspaceUri);
    if (rootKey !== undefined && preview?.rootUri !== current.toString()) {
      throw new Error(vscode.l10n.t('The external output folder changed during review.'));
    }
    return current;
  }

  private async assertTargetInsideWorkspace(
    folderUri: vscode.Uri,
    targetUri: vscode.Uri,
    useParent: boolean,
  ): Promise<void> {
    if (folderUri.scheme !== 'file' || targetUri.scheme !== 'file') {
      return;
    }
    const workspacePath = await resolveCanonicalWorkspacePath(folderUri.fsPath);
    if (!(await isRealPathInsideWorkspace(workspacePath, targetUri.fsPath, useParent))) {
      throw new Error(vscode.l10n.t('The file is outside the selected workspace folder.'));
    }
  }

  private async assertCommandPathsInsideWorkspace(
    folderUri: vscode.Uri,
    command: string,
  ): Promise<void> {
    if (folderUri.scheme !== 'file') {
      return;
    }
    const commandTokens = tokenizeWorkspaceCommand(command);
    if (commandTokens === undefined) {
      throw new Error(vscode.l10n.t('The file is outside the selected workspace folder.'));
    }
    const tokens = commandTokens
      .slice(1)
      .map((token) => {
        const assignment = token.indexOf('=');
        return assignment < 0 ? token : token.slice(assignment + 1);
      })
      .filter((token) => token !== '' && !token.startsWith('-'));
    for (const token of tokens) {
      const target = vscode.Uri.file(path.resolve(folderUri.fsPath, token));
      await this.assertTargetInsideWorkspace(folderUri, target, false);
    }
  }

  private async readOptional(uri: vscode.Uri): Promise<string | null> {
    const openDocument = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (openDocument !== undefined) {
      return openDocument.getText();
    }
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
