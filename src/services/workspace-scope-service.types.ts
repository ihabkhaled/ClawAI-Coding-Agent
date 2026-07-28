import type * as vscode from 'vscode';

export interface WorkspaceFolderScopePort {
  selectedFolder(): Pick<vscode.WorkspaceFolder, 'uri'>;
}
