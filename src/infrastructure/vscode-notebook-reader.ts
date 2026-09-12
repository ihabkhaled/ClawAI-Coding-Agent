import * as vscode from 'vscode';

import type { NotebookReaderPort } from '../services/notebook-tool.types';

/** Bigger than this is not a notebook anyone is editing a cell of. */
const MAX_NOTEBOOK_BYTES = 16 * 1024 * 1024;

/**
 * Reads a notebook from disk, through the same root addressing every other
 * workspace tool uses.
 *
 * Deliberately not `openNotebookDocument`. The editor's notebook model drops
 * fields it has no representation for, which is precisely the structure this
 * feature exists to preserve; the file on disk is the only complete copy.
 */
export class VscodeNotebookReader implements NotebookReaderPort {
  constructor(private readonly workspaceRootUri: (rootKey: string) => vscode.Uri) {}

  async read(rootKey: string, path: string): Promise<string> {
    const uri = vscode.Uri.joinPath(this.workspaceRootUri(rootKey), path);
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > MAX_NOTEBOOK_BYTES) {
      throw new Error(`Notebook is larger than ${String(MAX_NOTEBOOK_BYTES)} bytes: ${path}`);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}
