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
    };
    return this.finish([candidate], configuration, []);
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
    );
    return this.finish(read.candidates, configuration, ignore, [
      ...preReadExcluded,
      ...read.excluded,
    ]);
  }

  async projectRules(): Promise<string> {
    const folder = this.scope.selectedFolder();
    const canonicalWorkspacePath = await this.canonicalWorkspacePath(folder.uri);
    const ruleUris = [
      vscode.Uri.joinPath(folder.uri, '.clawai', 'rules.md'),
      vscode.Uri.joinPath(folder.uri, '.clawai', 'architecture.md'),
      vscode.Uri.joinPath(folder.uri, '.clawai', 'memory.md'),
    ];
    const globalContext = await this.globalContext?.readAll();
    const contents: string[] =
      globalContext === undefined || globalContext.length === 0 ? [] : [globalContext];
    for (const uri of ruleUris) {
      await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, uri);
      const content = await this.readOptionalText(uri);
      if (content !== null) {
        contents.push(`# ${this.scope.relativePath(uri)}\n${content}`);
      }
    }
    return contents.join('\n\n');
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
  ): Promise<WorkspaceReadResult> {
    const candidates: ContextCandidate[] = [];
    const excluded: ContextExclusion[] = [];
    let readBytes = 0;
    let readFiles = 0;
    for (const [index, file] of files.entries()) {
      const remainingBytes = maxBytes - readBytes;
      if (remainingBytes <= 0 || readFiles >= maxFiles) {
        excluded.push(
          ...files.slice(index).map((remaining) => ({
            path: remaining.path,
            reason: 'limit' as const,
          })),
        );
        break;
      }
      await this.assertRealPathInsideWorkspace(canonicalWorkspacePath, file.uri);
      const stat = await vscode.workspace.fs.stat(file.uri);
      if (stat.type !== vscode.FileType.File) {
        continue;
      }
      if (stat.size > remainingBytes) {
        excluded.push({ path: file.path, reason: 'limit' });
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(file.uri);
      readBytes += bytes.byteLength;
      readFiles += 1;
      if (bytes.byteLength > remainingBytes) {
        excluded.push({ path: file.path, reason: 'limit' });
        continue;
      }
      const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      candidates.push({
        path: file.path,
        content,
      });
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
