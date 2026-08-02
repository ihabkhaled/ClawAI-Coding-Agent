import * as vscode from 'vscode';

import type { RunJournalKeyPort, RunJournalStoragePort } from '../services/run-journal-service';

const keyName = 'clawAI.runtimeJournalEncryptionKey.v1';

function runFilename(runId: string): string {
  return `${Buffer.from(runId, 'utf8').toString('base64url')}.journal`;
}

export class VscodeRunJournalStorage implements RunJournalStoragePort {
  private readonly root: vscode.Uri;

  constructor(globalStorageUri: vscode.Uri) {
    this.root = vscode.Uri.joinPath(globalStorageUri, 'runtime-journals');
  }

  async read(runId: string): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(
        await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.root, runFilename(runId))),
      );
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound')
        return undefined;
      throw error;
    }
  }

  async write(runId: string, encrypted: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.root);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(this.root, runFilename(runId)),
      new TextEncoder().encode(encrypted),
    );
  }

  async delete(runId: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(this.root, runFilename(runId)), {
        recursive: false,
        useTrash: false,
      });
    } catch (error: unknown) {
      if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') throw error;
    }
  }

  async list(): Promise<readonly string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.root);
      return entries.flatMap(([name, type]) => {
        if (type !== vscode.FileType.File || !name.endsWith('.journal')) return [];
        try {
          return [Buffer.from(name.slice(0, -'.journal'.length), 'base64url').toString('utf8')];
        } catch {
          return [];
        }
      });
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return [];
      throw error;
    }
  }
}

export class VscodeRunJournalKeyStore implements RunJournalKeyPort {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<Uint8Array | undefined> {
    const encoded = await this.secrets.get(keyName);
    return encoded === undefined ? undefined : Buffer.from(encoded, 'base64url');
  }

  async set(value: Uint8Array): Promise<void> {
    await this.secrets.store(keyName, Buffer.from(value).toString('base64url'));
  }
}
