import * as vscode from 'vscode';

import { contentHash, type FileTransactionOperation } from '../core/file-transaction';
import {
  isRealPathInsideWorkspace,
  resolveCanonicalWorkspacePath,
} from '../core/workspace-file-containment';
import { WORKSPACE_ROOT_PATH } from '../core/workspace-path-policy';
import { advertisedWorkspaceRootIndex, workspaceFolderKey } from '../core/workspace-scope';

import type { ExternalOutputGrant } from '../core/external-output-grants';
import type { FileTransaction } from '../core/file-transaction';
import type {
  FileSnapshot,
  FileTransactionAdapter,
  PreparedFileOperation,
} from '../services/file-transaction-service';

interface ExternalOutputResolver {
  resolve(rootKey: string): ExternalOutputGrant | undefined;
}

const textDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Writes documents the transaction edited in place to disk.
 *
 * `WorkspaceEdit.replace` changes the editor buffer and nothing else. Without
 * this, an agent's edit left the file dirty and the disk unchanged while the
 * receipt reported "applied" with the new hash — so the next command the
 * agent ran, and the next commit it made, saw the old code. A tool that edits
 * source for a program to run has not edited it until the disk says so.
 *
 * A document that will not save fails the transaction, which the caller rolls
 * back. Reporting success for a change that never reached the disk is the
 * failure this exists to prevent, so it is not skipped quietly.
 */
async function saveToDisk(uris: readonly vscode.Uri[]): Promise<void> {
  for (const uri of uris) {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (document?.isDirty !== true) continue;
    if (!(await document.save())) {
      throw new Error(`VS Code could not save ${vscode.workspace.asRelativePath(uri)}`);
    }
  }
}

export class VscodeFileTransactionAdapter implements FileTransactionAdapter {
  private readonly createdDirectories = new Map<string, vscode.Uri[]>();
  /** Documents each transaction edited in place, so a rollback can save them too. */
  private readonly editedDocuments = new Map<string, vscode.Uri[]>();
  private readonly committed = new Set<string>();
  private readonly runtimeRoots = new Map<string, vscode.Uri>();

  constructor(private readonly externalOutputs?: ExternalOutputResolver) {}

  isTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  async uriFor(
    rootKey: string,
    relativePath: string,
    operation: FileTransactionOperation['kind'] | 'read' = 'update',
  ): Promise<vscode.Uri> {
    return this.containedUri(this.root(rootKey, operation), relativePath, operation === 'create');
  }

  rootUri(rootKey: string): vscode.Uri {
    return this.root(rootKey, 'update');
  }

  workspaceRootUri(rootKey: string): vscode.Uri {
    const runtime = this.runtimeRoots.get(rootKey);
    if (runtime !== undefined) return runtime;
    const advertisedIndex = advertisedWorkspaceRootIndex(rootKey);
    const advertised =
      advertisedIndex === undefined
        ? undefined
        : (vscode.workspace.workspaceFolders ?? [])[advertisedIndex];
    if (advertised !== undefined) return advertised.uri;
    const workspace = (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => workspaceFolderKey(folder.uri.toString()) === rootKey,
    );
    if (workspace === undefined) throw new Error('Command roots must be workspace folders');
    return workspace.uri;
  }

  /**
   * Saves the open, dirty documents among these targets.
   *
   * Only documents that are actually open and actually dirty are touched, and
   * a path that will not resolve is skipped rather than failing the
   * transaction: autosave is a convenience ahead of the real work, and a
   * convenience that can abort an edit is worse than no convenience.
   */
  async saveIfDirty(
    targets: readonly { readonly rootKey: string; readonly path: string }[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (const target of targets) {
      signal?.throwIfAborted();
      let uri: vscode.Uri;
      try {
        uri = await this.uriFor(target.rootKey, target.path, 'update');
      } catch {
        continue;
      }
      const open = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === uri.toString(),
      );
      if (open?.isDirty !== true) continue;
      await open.save();
    }
  }

  registerRuntimeRoot(rootKey: string, rootPath: string): void {
    if (this.runtimeRoots.has(rootKey)) throw new Error('Runtime root is already registered');
    this.runtimeRoots.set(rootKey, vscode.Uri.file(rootPath));
  }

  unregisterRuntimeRoot(rootKey: string): void {
    this.runtimeRoots.delete(rootKey);
  }

  async snapshot(operation: FileTransactionOperation, signal?: AbortSignal): Promise<FileSnapshot> {
    signal?.throwIfAborted();
    const root = this.root(operation.rootKey, operation.kind);
    const uri = await this.containedUri(root, operation.path, operation.kind === 'create');
    const open = vscode.workspace.textDocuments.find(
      (document) => document.uri.toString() === uri.toString(),
    );
    if (open !== undefined) {
      const text = open.getText();
      const bytes = new TextEncoder().encode(text);
      return {
        rootKey: operation.rootKey,
        path: operation.path,
        kind: 'file',
        hash: contentHash(bytes),
        bytes,
        text,
        openBufferVersion: open.version,
      };
    }
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.Directory) !== 0) {
        return { rootKey: operation.rootKey, path: operation.path, kind: 'directory', hash: null };
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      let text: string | undefined;
      try {
        text = textDecoder.decode(bytes);
      } catch {
        text = undefined;
      }
      return {
        rootKey: operation.rootKey,
        path: operation.path,
        kind: 'file',
        hash: contentHash(bytes),
        bytes,
        ...(text === undefined ? {} : { text }),
      };
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return { rootKey: operation.rootKey, path: operation.path, kind: 'missing', hash: null };
      }
      throw error;
    }
  }

  async apply(
    transaction: FileTransaction,
    prepared: readonly PreparedFileOperation[],
    signal?: AbortSignal,
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const directories: vscode.Uri[] = [];
    const replaced: vscode.Uri[] = [];
    for (const item of prepared) {
      signal?.throwIfAborted();
      const root = this.root(item.operation.rootKey, item.operation.kind);
      const uri = await this.containedUri(
        root,
        item.operation.path,
        item.before.kind === 'missing',
      );
      if (item.operation.kind === 'mkdir') {
        await vscode.workspace.fs.createDirectory(uri);
        directories.push(uri);
      } else if (item.operation.kind === 'delete') {
        edit.deleteFile(uri, { ignoreIfNotExists: false, recursive: false });
      } else if (item.operation.kind === 'rename') {
        const destination = await this.containedUri(root, item.operation.destination, true);
        edit.renameFile(uri, destination, { overwrite: false });
      } else if (item.operation.kind === 'create' || item.operation.kind === 'artifact') {
        edit.createFile(uri, {
          contents: this.requiredBytes(item.afterBytes, 'Created file content is missing'),
          ignoreIfExists: false,
          overwrite: false,
        });
      } else if (item.operation.kind === 'copy') {
        const destination = await this.containedUri(root, item.operation.destination, true);
        edit.createFile(destination, {
          contents: this.requiredBytes(item.afterBytes, 'Copied file content is missing'),
          ignoreIfExists: false,
          overwrite: false,
        });
      } else {
        const document = await vscode.workspace.openTextDocument(uri);
        const end = document.lineAt(document.lineCount - 1).rangeIncludingLineBreak.end;
        edit.replace(uri, new vscode.Range(new vscode.Position(0, 0), end), item.afterText ?? '');
        replaced.push(uri);
      }
    }
    this.createdDirectories.set(transaction.transactionId, directories);
    signal?.throwIfAborted();
    if (!(await vscode.workspace.applyEdit(edit)))
      throw new Error('VS Code rejected the file transaction');
    this.committed.add(transaction.transactionId);
    this.editedDocuments.set(transaction.transactionId, replaced);
    // Marked committed first, so a save that fails below is rolled back like
    // any other failure of this transaction.
    await saveToDisk(replaced);
  }

  async rollback(
    transaction: FileTransaction,
    prepared: readonly PreparedFileOperation[],
  ): Promise<void> {
    const directories = this.createdDirectories.get(transaction.transactionId) ?? [];
    this.createdDirectories.delete(transaction.transactionId);
    if (this.committed.delete(transaction.transactionId)) {
      const inverse = new vscode.WorkspaceEdit();
      for (const item of [...prepared].reverse()) {
        await this.appendInverse(inverse, item);
      }
      if (!(await vscode.workspace.applyEdit(inverse)))
        throw new Error('VS Code rejected the file transaction rollback');
      // The forward edit was saved, so undoing it only in the buffer would
      // leave the rolled-back content on disk and a dirty editor showing the
      // opposite. Both halves of the transaction reach the disk or neither does.
      await saveToDisk(this.editedDocuments.get(transaction.transactionId) ?? []);
    }
    this.editedDocuments.delete(transaction.transactionId);
    for (const uri of [...directories].reverse()) {
      try {
        await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: true });
      } catch {
        // A non-empty or externally changed directory is intentionally retained.
      }
    }
  }

  private async appendInverse(
    inverse: vscode.WorkspaceEdit,
    item: PreparedFileOperation,
  ): Promise<void> {
    const root = this.root(item.operation.rootKey, item.operation.kind);
    const uri = await this.containedUri(root, item.operation.path, true);
    if (item.operation.kind === 'create' || item.operation.kind === 'artifact')
      inverse.deleteFile(uri, { ignoreIfNotExists: true, recursive: false });
    else if (item.operation.kind === 'delete')
      inverse.createFile(uri, {
        contents: this.requiredBytes(item.before.bytes, 'Deleted file snapshot is missing'),
        ignoreIfExists: false,
        overwrite: false,
      });
    else if (item.operation.kind === 'rename')
      inverse.renameFile(await this.containedUri(root, item.operation.destination, false), uri, {
        overwrite: false,
      });
    else if (item.operation.kind === 'copy')
      inverse.deleteFile(await this.containedUri(root, item.operation.destination, false), {
        ignoreIfNotExists: true,
        recursive: false,
      });
    else if (item.operation.kind !== 'mkdir') {
      const document = await vscode.workspace.openTextDocument(uri);
      const end = document.lineAt(document.lineCount - 1).rangeIncludingLineBreak.end;
      inverse.replace(
        uri,
        new vscode.Range(new vscode.Position(0, 0), end),
        item.before.text ?? '',
      );
    }
  }

  private requiredBytes(bytes: Uint8Array | undefined, message: string): Uint8Array {
    if (bytes === undefined) throw new Error(message);
    return bytes;
  }

  private root(rootKey: string, operation: FileTransactionOperation['kind'] | 'read'): vscode.Uri {
    const runtime = this.runtimeRoots.get(rootKey);
    if (runtime !== undefined) return runtime;
    const advertisedIndex = advertisedWorkspaceRootIndex(rootKey);
    const advertised =
      advertisedIndex === undefined
        ? undefined
        : (vscode.workspace.workspaceFolders ?? [])[advertisedIndex];
    if (advertised !== undefined) return advertised.uri;
    const workspace = (vscode.workspace.workspaceFolders ?? []).find(
      (folder) => workspaceFolderKey(folder.uri.toString()) === rootKey,
    );
    if (workspace !== undefined) return workspace.uri;
    const grant = this.externalOutputs?.resolve(rootKey);
    if (grant === undefined) throw new Error('The requested filesystem root is not approved');
    if (!['create', 'update', 'artifact'].includes(operation))
      throw new Error('External output roots permit only create or update effects');
    return vscode.Uri.parse(grant.uri);
  }

  private async containedUri(
    root: vscode.Uri,
    relativePath: string,
    create: boolean,
  ): Promise<vscode.Uri> {
    if (root.scheme !== 'file') throw new Error('This filesystem operation requires a file root');
    // The empty relative path IS the root. Joining an empty segment relies on
    // Uri.joinPath's normalization, so the root is resolved explicitly instead.
    // Containment still runs below, which is what actually enforces the
    // boundary — a root that is itself a symlink out of the workspace is
    // rejected exactly as any other target would be.
    const target =
      relativePath === WORKSPACE_ROOT_PATH
        ? root
        : vscode.Uri.joinPath(root, ...relativePath.replaceAll('\\', '/').split('/'));
    const canonicalRoot = await resolveCanonicalWorkspacePath(root.fsPath);
    if (!(await isRealPathInsideWorkspace(canonicalRoot, target.fsPath, create)))
      throw new Error('Filesystem target escapes through a symbolic link or junction');
    return target;
  }
}
