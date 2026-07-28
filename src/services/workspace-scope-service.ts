import path from 'node:path';

import * as vscode from 'vscode';

import {
  buildWorkspaceScope,
  requireWorkspaceScopeCandidate,
  workspaceFolderKey,
} from '../core/workspace-scope';

import type {
  WorkspaceScopeCandidate,
  WorkspaceScopeSnapshot,
} from '../core/workspace-scope.types';

export class WorkspaceScopeService {
  private explicitFolderKey: string | undefined;

  snapshot(): WorkspaceScopeSnapshot {
    const candidates = this.candidates();
    const activeFolder = this.activeEditorFolder();
    return buildWorkspaceScope(candidates, this.explicitFolderKey, activeFolder?.uri.toString());
  }

  refresh(): WorkspaceScopeSnapshot {
    if (
      this.explicitFolderKey !== undefined &&
      !this.candidates().some(
        (candidate) => workspaceFolderKey(candidate.uri) === this.explicitFolderKey,
      )
    ) {
      this.explicitFolderKey = undefined;
    }
    return this.snapshot();
  }

  select(folderKey: string): WorkspaceScopeSnapshot {
    requireWorkspaceScopeCandidate(this.candidates(), folderKey);
    this.explicitFolderKey = folderKey;
    return this.snapshot();
  }

  selectedFolder(): vscode.WorkspaceFolder {
    const snapshot = this.refresh();
    if (snapshot.selectedFolderKey === undefined) {
      throw new Error(vscode.l10n.t('Open a workspace before running ClawAI.'));
    }
    const folder = this.workspaceFolders().find(
      (candidate) => workspaceFolderKey(candidate.uri.toString()) === snapshot.selectedFolderKey,
    );
    if (folder === undefined) {
      throw new Error(vscode.l10n.t('The selected workspace folder is no longer available.'));
    }
    return folder;
  }

  owns(uri: vscode.Uri): boolean {
    try {
      const selected = this.selectedFolder();
      return vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === selected.uri.toString();
    } catch {
      return false;
    }
  }

  relativePath(uri: vscode.Uri): string {
    const selected = this.selectedFolder();
    const owner = vscode.workspace.getWorkspaceFolder(uri);
    if (owner?.uri.toString() !== selected.uri.toString()) {
      throw new Error(vscode.l10n.t('The file is outside the selected workspace folder.'));
    }
    return path.posix.relative(selected.uri.path, uri.path).replaceAll('\\', '/');
  }

  private activeEditorFolder(): vscode.WorkspaceFolder | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor === undefined
      ? undefined
      : vscode.workspace.getWorkspaceFolder(editor.document.uri);
  }

  private candidates(): WorkspaceScopeCandidate[] {
    return this.workspaceFolders().map((folder) => ({
      name: folder.name,
      uri: folder.uri.toString(),
    }));
  }

  private workspaceFolders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }
}
