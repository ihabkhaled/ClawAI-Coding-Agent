import * as vscode from 'vscode';

/** The scheme the editable right-hand side of a preview is served from. */
export const PREVIEW_DRAFT_SCHEME = 'clawai-draft';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * An in-memory, writable file system for the right-hand side of a preview.
 *
 * A `TextDocumentContentProvider` is read-only by construction, which is why
 * the proposal could be read and never corrected. A `FileSystemProvider` is
 * the only way VS Code offers an editable buffer for a virtual document, so
 * the after side moves here and the before side stays read-only — a diff whose
 * *left* pane could be edited would be inviting someone to rewrite history.
 *
 * Nothing here touches disk. A draft exists until the batch is trimmed or the
 * provider is disposed, and applying the plan is still the only thing that
 * writes to the workspace.
 */
export class PreviewDraftFileSystem implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly files = new Map<string, Uint8Array>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly registration: vscode.Disposable;
  readonly onDidChangeFile = this.changeEmitter.event;

  constructor() {
    this.registration = vscode.workspace.registerFileSystemProvider(PREVIEW_DRAFT_SCHEME, this, {
      isCaseSensitive: true,
    });
  }

  /** Seeds a draft with the proposed content. */
  set(uri: vscode.Uri, content: string): void {
    this.files.set(uri.toString(), encoder.encode(content));
  }

  /** The current draft text, which is the proposal until someone edits it. */
  text(uri: vscode.Uri): string | undefined {
    const bytes = this.files.get(uri.toString());
    return bytes === undefined ? undefined : decoder.decode(bytes);
  }

  forget(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const bytes = this.files.get(uri.toString());
    if (bytes === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return bytes;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    // Only a draft this provider already seeded can be written. A save to an
    // unknown path would be inventing a file the plan never proposed.
    if (!this.files.has(uri.toString())) throw vscode.FileSystemError.FileNotFound(uri);
    this.files.set(uri.toString(), content);
    this.changeEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const bytes = this.files.get(uri.toString());
    if (bytes === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.byteLength };
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  // A draft is one file with no directory around it, so the rest of the
  // interface refuses rather than pretending to a shape that does not exist.
  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Preview drafts have no directories');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Preview drafts cannot be deleted');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Preview drafts cannot be renamed');
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  dispose(): void {
    this.registration.dispose();
    this.changeEmitter.dispose();
    this.files.clear();
  }
}
