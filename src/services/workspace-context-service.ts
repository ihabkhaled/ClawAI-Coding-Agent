import * as vscode from 'vscode';

import {
  collectContext,
  type CollectedContext,
  type ContextCandidate,
  type ContextReceipt,
  workspaceGlobToRegExp,
} from '../core/context-collector';
import {
  resolveSmartContext,
  type ContextMode,
  type WorkspaceReadiness,
} from '../core/context-mode';
import { EMPTY_CONTEXT } from '../core/empty-context';
import { findFileRangeReferences, findMentionedPaths } from '../core/file-range-reference';
import { memoryFileCandidates } from '../core/memory-file-discovery';
import { forEachPrefetched, readConcurrency } from '../core/speed-mode';
import {
  isRealPathInsideWorkspace,
  resolveCanonicalWorkspacePath,
} from '../core/workspace-file-containment';
import { isSensitiveWorkspacePath } from '../core/workspace-path-policy';

import { WorkspaceScopeService } from './workspace-scope-service';

import type { RuntimeConfiguration } from './configuration-service';
import type { GlobalContextPort } from './global-context-service';
import type { WorkspaceScopeSnapshot } from '../core/workspace-scope.types';

const CLAWAI_IGNORE_PATH = '.clawai/ignore';
const FILE_SCAN_MULTIPLIER = 10;

type ContextExclusion = ContextReceipt['excluded'][number];

interface WorkspaceFileCandidate {
  path: string;
  uri: vscode.Uri;
}

interface WorkspaceReadResult {
  candidates: ContextCandidate[];
  excluded: ContextExclusion[];
}

export class WorkspaceContextService {
  constructor(
    private readonly globalContext?: GlobalContextPort,
    private readonly scope = new WorkspaceScopeService(),
  ) {}

  readiness(): WorkspaceReadiness {
    const editor = vscode.window.activeTextEditor;
    const workspace = this.scope.refresh();
    const hasActiveFile = editor !== undefined && this.scope.owns(editor.document.uri);
    const hasSelection = editor === undefined ? false : hasActiveFile && !editor.selection.isEmpty;
    return {
      hasActiveFile,
      hasSelection,
      hasWorkspace: workspace.selectedFolderKey !== undefined,
      trusted: vscode.workspace.isTrusted,
      ...(workspace.selectedFolderName === undefined
        ? {}
        : { workspaceName: workspace.selectedFolderName }),
    };
  }

  resolve(mode: ContextMode): Exclude<ContextMode, 'smart'> {
    return mode === 'smart' ? resolveSmartContext(this.readiness()) : mode;
  }

  scopeSnapshot(): WorkspaceScopeSnapshot {
    return this.scope.refresh();
  }

  freezeWorkspaceFolder(): void {
    if (this.scope.refresh().selectedFolderKey !== undefined) {
      this.scope.selectedFolder();
    }
  }

  selectWorkspaceFolder(folderKey: string): void {
    this.scope.select(folderKey);
  }

  smart(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    return this.collect(this.resolve('smart'), configuration);
  }

  collect(
    mode: Exclude<ContextMode, 'smart'>,
    configuration: RuntimeConfiguration,
  ): Promise<CollectedContext> {
    if (mode === 'none') {
      return Promise.resolve(EMPTY_CONTEXT);
    }
    if (mode === 'selection') {
      return this.selection(configuration);
    }
    if (mode === 'file') {
      return this.activeFile(configuration);
    }
    return this.workspace(configuration);
  }

  async selection(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      throw new Error(vscode.l10n.t('Select code before running this command.'));
    }
    const folder = this.scope.selectedFolder();
    const path = this.scope.relativePath(editor.document.uri);
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, editor.document.uri);
    const candidate = {
      path,
      content: editor.document.getText(editor.selection),
      // VS Code positions are 0-indexed; the range a person reads and types
      // is 1-indexed.
      startLine: editor.selection.start.line + 1,
      endLine: editor.selection.end.line + 1,
    };
    return this.finish([candidate], configuration, []);
  }

  /**
   * Resolves the file references written into the prompt text itself — a
   * `path:L-L` range, or a whole-file `@path` mention — so a message can pull
   * in any workspace file regardless of what is open or selected. A reference
   * that does not resolve — outside the workspace, missing, sensitive, or past
   * the end of the file — is silently skipped rather than failing the whole
   * request: free text can coincide with the syntax by accident, and a typo
   * should not block a send.
   */
  async referencedRanges(
    promptText: string,
    configuration: RuntimeConfiguration,
  ): Promise<CollectedContext> {
    const references = findFileRangeReferences(promptText);
    const mentioned = findMentionedPaths(promptText);
    if (
      (references.length === 0 && mentioned.length === 0) ||
      this.scope.refresh().selectedFolderKey === undefined
    ) {
      return EMPTY_CONTEXT;
    }
    const folder = this.scope.selectedFolder();
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    const candidates: ContextCandidate[] = [];
    for (const path of mentioned) {
      const text = await this.readReferencedFile(folder.uri, canonicalWorkspacePath, path);
      if (text !== undefined) candidates.push({ path, content: text });
    }
    for (const reference of references) {
      const text = await this.readReferencedFile(
        folder.uri,
        canonicalWorkspacePath,
        reference.path,
      );
      if (text === undefined) continue;
      const lines = text.split(/\r?\n/u);
      if (reference.startLine > lines.length) continue;
      const endLine = Math.min(reference.endLine, lines.length);
      candidates.push({
        path: reference.path,
        content: lines.slice(reference.startLine - 1, endLine).join('\n'),
        startLine: reference.startLine,
        endLine,
      });
    }
    return this.finish(candidates, configuration, []);
  }

  /**
   * One referenced workspace file, or nothing if it may not be handed over.
   *
   * The screen is the same for a ranged reference and a whole-file mention,
   * because the question is the same: naming a file in a prompt is not
   * authority to read one outside the workspace. A path that fails is skipped
   * silently — a typo must not block a send.
   *
   * Secrets are not screened here on purpose. `finish` already drops them and
   * records why in the receipt, and a user who mentions `.env` is better told
   * it was excluded than left wondering why their message did nothing.
   */
  private async readReferencedFile(
    folderUri: vscode.Uri,
    canonicalWorkspacePath: string | undefined,
    path: string,
  ): Promise<string | undefined> {
    const uri = vscode.Uri.joinPath(folderUri, path);
    if (
      canonicalWorkspacePath !== undefined &&
      uri.scheme === 'file' &&
      !(await isRealPathInsideWorkspace(canonicalWorkspacePath, uri.fsPath))
    ) {
      return undefined;
    }
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(
        await vscode.workspace.fs.readFile(uri),
      );
    } catch {
      return undefined;
    }
  }

  async activeFile(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      throw new Error(vscode.l10n.t('Open a file before running this command.'));
    }
    const folder = this.scope.selectedFolder();
    const path = this.scope.relativePath(editor.document.uri);
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, editor.document.uri);
    const candidate = {
      path,
      content: editor.document.getText(),
    };
    return this.finish([candidate], configuration, []);
  }

  async workspace(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    if (!vscode.workspace.isTrusted) {
      throw new Error(vscode.l10n.t('Trust this workspace before collecting project context.'));
    }
    const folder = this.scope.selectedFolder();
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    const ignore = await this.readIgnore(folder.uri, canonicalWorkspacePath);
    const excludedPatterns = [...configuration.exclude, ...ignore];
    const patterns = excludedPatterns.map(workspaceGlobToRegExp);
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      undefined,
      configuration.maxContextFiles * FILE_SCAN_MULTIPLIER,
    );
    const preReadExcluded: ContextExclusion[] = [];
    const eligible = uris.flatMap((uri): WorkspaceFileCandidate[] => {
      const path = this.scope.relativePath(uri);
      if (isSensitiveWorkspacePath(path)) {
        preReadExcluded.push({ path, reason: 'sensitive' });
        return [];
      }
      if (patterns.some((pattern) => pattern.test(path))) {
        preReadExcluded.push({ path, reason: 'excluded' });
        return [];
      }
      return [{ path, uri }];
    });
    const read = await this.readCandidates(
      eligible,
      configuration.maxContextBytes,
      configuration.maxContextFiles,
      canonicalWorkspacePath,
      readConcurrency(configuration.speedMode),
    );
    return this.finish(read.candidates, configuration, ignore, [
      ...preReadExcluded,
      ...read.excluded,
    ]);
  }

  /**
   * Standing guidance, weakest first: profile, then workspace root, then every
   * directory down to the file being worked on.
   *
   * Nested discovery is the point. A repository-wide rule and a rule for one
   * package are both true, and when they disagree the package is the one that
   * meant it — so the nearer file is read last and therefore speaks last. A
   * fixed three files at the root could not express that at all.
   */
  async projectRules(): Promise<string> {
    const folder = this.scope.selectedFolder();
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    const globalContext = await this.globalContext?.readAll();
    const contents: string[] =
      globalContext === undefined || globalContext.length === 0 ? [] : [globalContext];
    for (const candidate of memoryFileCandidates(this.activeRelativePath())) {
      const uri = vscode.Uri.joinPath(folder.uri, ...candidate.split('/'));
      await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, uri);
      const content = await this.readOptionalText(uri);
      if (content !== null) {
        contents.push(`# ${this.scope.relativePath(uri)}\n${content}`);
      }
    }
    return contents.join('\n\n');
  }

  /**
   * The open file's path relative to the selected folder, when it belongs to it.
   *
   * A file from another folder resolves to nothing rather than to a path that
   * would be joined onto the wrong root.
   */
  private activeRelativePath(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || !this.scope.owns(editor.document.uri)) return undefined;
    return this.scope.relativePath(editor.document.uri);
  }

  private finish(
    candidates: ContextCandidate[],
    configuration: RuntimeConfiguration,
    workspaceIgnore: string[],
    preReadExcluded: ContextExclusion[] = [],
  ): CollectedContext {
    const collected = collectContext(candidates, {
      exclude: [...configuration.exclude, ...workspaceIgnore],
      maxBytes: configuration.maxContextBytes,
      maxFiles: configuration.maxContextFiles,
    });
    return {
      ...collected,
      receipt: {
        ...collected.receipt,
        excluded: [...preReadExcluded, ...collected.receipt.excluded],
        truncated:
          collected.receipt.truncated || preReadExcluded.some((entry) => entry.reason === 'limit'),
      },
    };
  }

  private async readCandidates(
    files: WorkspaceFileCandidate[],
    maxBytes: number,
    maxFiles: number,
    canonicalWorkspacePath: string | undefined,
    concurrency: number,
  ): Promise<WorkspaceReadResult> {
    const candidates: ContextCandidate[] = [];
    const excluded: ContextExclusion[] = [];
    let readBytes = 0;
    let readFiles = 0;
    let failure: unknown;

    // The reads run in bounded parallel; the accounting below stays sequential
    // and in order, because which files fit depends on how many bytes the ones
    // before them consumed. Deciding in parallel would change the context.
    await forEachPrefetched(
      files,
      concurrency,
      // Containment check and stat only. Reading bytes here would be faster
      // still and would defeat the point of the size check below: a run would
      // pull every near-limit candidate into memory just to discard it.
      async (file) => {
        await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, file.uri);
        return vscode.workspace.fs.stat(file.uri);
      },
      async (file, fetched, index) => {
        const remainingBytes = maxBytes - readBytes;
        if (remainingBytes <= 0 || readFiles >= maxFiles) {
          excluded.push(
            ...files.slice(index).map((remaining) => ({
              path: remaining.path,
              reason: 'limit' as const,
            })),
          );
          return 'stop';
        }
        if (!fetched.ok) {
          // Surfaced only for a file the sequential loop actually reached, so a
          // speculatively prefetched neighbour cannot raise an error that the
          // one-at-a-time path would never have produced.
          failure = fetched.error;
          return 'stop';
        }
        const stat = fetched.value;
        if (stat.type !== vscode.FileType.File) {
          return 'continue';
        }
        if (stat.size > remainingBytes) {
          excluded.push({ path: file.path, reason: 'limit' });
          return 'continue';
        }
        const bytes = await vscode.workspace.fs.readFile(file.uri);
        readBytes += bytes.byteLength;
        readFiles += 1;
        if (bytes.byteLength > remainingBytes) {
          excluded.push({ path: file.path, reason: 'limit' });
          return 'continue';
        }
        candidates.push({
          content: new TextDecoder('utf-8', { fatal: false }).decode(bytes),
          path: file.path,
        });
        return 'continue';
      },
    );

    if (failure !== undefined) {
      throw failure instanceof Error ? failure : new Error(JSON.stringify(failure));
    }
    return { candidates, excluded };
  }

  private async readIgnore(
    folderUri: vscode.Uri,
    canonicalWorkspacePath: string | undefined,
  ): Promise<string[]> {
    const ignoreUri = vscode.Uri.joinPath(folderUri, CLAWAI_IGNORE_PATH);
    await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, ignoreUri);
    const content = await this.readOptionalText(ignoreUri);
    if (content === null) {
      return [];
    }
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  private async canonicalWorkspacePath(folderUri: vscode.Uri): Promise<string | undefined> {
    return folderUri.scheme === 'file'
      ? resolveCanonicalWorkspacePath(folderUri.fsPath)
      : Promise.resolve(undefined);
  }

  private async assertRealPathInsideWorkspace(
    canonicalWorkspacePath: string | undefined,
    uri: vscode.Uri,
  ): Promise<void> {
    if (
      canonicalWorkspacePath !== undefined &&
      uri.scheme === 'file' &&
      !(await isRealPathInsideWorkspace(canonicalWorkspacePath, uri.fsPath))
    ) {
      throw new Error(vscode.l10n.t('The file is outside the selected workspace folder.'));
    }
  }

  private async readOptionalText(uri: vscode.Uri): Promise<string | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return new TextDecoder().decode(bytes);
    } catch (error: unknown) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return null;
      }
      throw error;
    }
  }
}
