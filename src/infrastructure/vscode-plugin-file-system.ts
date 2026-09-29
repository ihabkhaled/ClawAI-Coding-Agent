import { join } from 'node:path';

import * as vscode from 'vscode';

import type { PluginDirectoryEntry, PluginFileSystemPort } from '../services/plugin-store.types';

/** Plugin file access through VS Code's file system, so remote and virtual workspaces work. */
export class VscodePluginFileSystem implements PluginFileSystemPort {
  async list(path: string): Promise<readonly PluginDirectoryEntry[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(path));
      return entries
        .filter(([, kind]) => kind === vscode.FileType.File || kind === vscode.FileType.Directory)
        .map(([name, kind]) => ({
          name,
          kind: kind === vscode.FileType.Directory ? 'directory' : 'file',
        }));
    } catch {
      return [];
    }
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    try {
      return await vscode.workspace.fs.readFile(vscode.Uri.file(path));
    } catch {
      return undefined;
    }
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.file(path), bytes);
  }

  async delete(path: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(path), { recursive: true, useTrash: false });
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
      throw error;
    }
  }

  join(base: string, ...segments: string[]): string {
    return join(base, ...segments);
  }
}
