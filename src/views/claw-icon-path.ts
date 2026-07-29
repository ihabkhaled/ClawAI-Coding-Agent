import * as vscode from 'vscode';

export function createClawIconPath(extensionUri: vscode.Uri): vscode.IconPath {
  return {
    dark: vscode.Uri.joinPath(extensionUri, 'resources', 'claw-dark.svg'),
    light: vscode.Uri.joinPath(extensionUri, 'resources', 'claw-light.svg'),
  };
}
