import * as vscode from 'vscode';

import { containedPath } from '../core/workspace-containment';
import { isSafeRelativeWorkspacePath } from '../core/workspace-path-policy';

/**
 * Turns a model-supplied notebook path into a URI that is really inside the
 * workspace root.
 *
 * `Uri.joinPath` alone normalises `..` away silently and follows symbolic
 * links, so a notebook path could read any file the editor can. The lexical
 * rule refuses absolute, drive-letter, UNC, `..`, device-name and sensitive
 * paths; the real-path rule then refuses a link that leaves the root.
 * A non-file root (a remote workspace) has no local real path to check, so it
 * gets the lexical rule only.
 */
export function resolveNotebookUri(root: vscode.Uri, relativePath: string): vscode.Uri {
  if (!isSafeRelativeWorkspacePath(relativePath)) {
    throw new Error(`Notebook path must stay inside the workspace: ${relativePath}`);
  }
  if (root.scheme !== 'file') return vscode.Uri.joinPath(root, relativePath);
  return vscode.Uri.file(containedPath(root.fsPath, relativePath));
}
