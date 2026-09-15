import * as vscode from 'vscode';

import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import {
  WORKSPACE_SCAN_EXCLUDE_GLOB,
  WORKSPACE_SCAN_MAX_RESULTS,
} from './workspace-scan.constants';

import type { MentionIndexPort } from '../services/mention-suggestion.types';

/**
 * How long a listing is reused before the workspace is walked again.
 *
 * A mention list is asked for on every keystroke, and `findFiles` over a large
 * repository is not a per-keystroke operation. Two seconds is short enough
 * that a file created while typing shows up in the same sitting, and long
 * enough that a burst of typing costs one walk.
 */
const CACHE_MS = 2_000;

/** How many folders the listing carries, so a mention can narrow by directory first. */
const MAX_DIRECTORIES = 500;

/**
 * The workspace paths a mention may name.
 *
 * Directories are included as their own entries, ending in `/`, because
 * narrowing by folder is how a person finds a file whose name they do not
 * remember. Sensitive paths are left out of the list entirely: a name that
 * cannot be handed over should not be offered, since offering it and then
 * refusing it teaches nothing.
 */
export class VscodeMentionIndex implements MentionIndexPort {
  private cached: readonly string[] = [];
  private cachedAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  async paths(): Promise<readonly string[]> {
    if (this.now() - this.cachedAt < CACHE_MS && this.cached.length > 0) return this.cached;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder === undefined) return [];
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      WORKSPACE_SCAN_EXCLUDE_GLOB,
      WORKSPACE_SCAN_MAX_RESULTS,
    );
    const files: string[] = [];
    const directories = new Set<string>();
    for (const uri of uris) {
      const path = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
      if (isSensitiveWorkspacePath(path)) continue;
      files.push(path);
      let cut = path.lastIndexOf('/');
      while (cut > 0 && directories.size < MAX_DIRECTORIES) {
        directories.add(`${path.slice(0, cut)}/`);
        cut = path.lastIndexOf('/', cut - 1);
      }
    }
    this.cached = [...files, ...directories];
    this.cachedAt = this.now();
    return this.cached;
  }
}
