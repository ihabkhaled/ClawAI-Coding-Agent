import * as vscode from 'vscode';

import {
  collectContext,
  type CollectedContext,
  type ContextCandidate,
} from '../core/context-collector';
import {
  resolveSmartContext,
  type ContextMode,
  type WorkspaceReadiness,
} from '../core/context-mode';
import { EMPTY_CONTEXT } from '../core/empty-context';

import { WorkspaceScopeService } from './workspace-scope-service';

import type { RuntimeConfiguration } from './configuration-service';
import type { GlobalContextPort } from './global-context-service';
import type { WorkspaceScopeSnapshot } from '../core/workspace-scope.types';

const CLAWAI_IGNORE_PATH = '.clawai/ignore';
const FILE_SCAN_MULTIPLIER = 10;

function isAlwaysDeniedPath(path: string): boolean {
  return /(?:^|\/)(?:\.git|node_modules|\.env(?:\.|$)|[^/]*(?:secret|credential|api[-_]?key)[^/]*)(?:\/|$)/iu.test(
    path,
  );
}

function globToRegExp(glob: string): RegExp {
  let pattern = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const next = glob[index + 1];
    if (character === '*' && next === '*') {
      pattern += '.*';
      index += 1;
    } else if (character === '*') {
      pattern += '[^/]*';
    } else if (character === '?') {
      pattern += '[^/]';
    } else if (character !== undefined) {
      pattern += character.replace(/[\\^$.[\]{}()+|]/gu, '\\$&');
    }
  }
  return new RegExp(`${pattern}$`, 'u');
}

export class WorkspaceContextService {
  constructor(
    private readonly globalContext?: GlobalContextPort,
    private readonly scope = new WorkspaceScopeService(),
  ) {}

  readiness(): WorkspaceReadiness {
    const editor = vscode.window.activeTextEditor;
    const workspace = this.scope.refresh();
    return {
      hasActiveFile: editor !== undefined,
      hasSelection: editor !== undefined && !editor.selection.isEmpty,
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

  selection(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.selection.isEmpty) {
      throw new Error(vscode.l10n.t('Select code before running this command.'));
    }
    const candidate = {
      path: this.scope.relativePath(editor.document.uri),
      content: editor.document.getText(editor.selection),
    };
    return Promise.resolve(this.finish([candidate], configuration, []));
  }

  activeFile(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      throw new Error(vscode.l10n.t('Open a file before running this command.'));
    }
    const candidate = {
      path: this.scope.relativePath(editor.document.uri),
      content: editor.document.getText(),
    };
    return Promise.resolve(this.finish([candidate], configuration, []));
  }

  async workspace(configuration: RuntimeConfiguration): Promise<CollectedContext> {
    if (!vscode.workspace.isTrusted) {
      throw new Error(vscode.l10n.t('Trust this workspace before collecting project context.'));
    }
    const folder = this.scope.selectedFolder();
    const ignore = await this.readIgnore();
    const excludedPatterns = [...configuration.exclude, ...ignore];
    const patterns = excludedPatterns.map(globToRegExp);
    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      undefined,
      configuration.maxContextFiles * FILE_SCAN_MULTIPLIER,
    );
    const eligible = uris.filter((uri) => {
      const path = this.scope.relativePath(uri);
      return !isAlwaysDeniedPath(path) && !patterns.some((pattern) => pattern.test(path));
    });
    const candidates = await this.readCandidates(eligible, configuration.maxContextBytes);
    return this.finish(candidates, configuration, ignore);
  }

  async projectRules(): Promise<string> {
    const folder = this.scope.selectedFolder();
    const ruleUris = [
      vscode.Uri.joinPath(folder.uri, '.clawai', 'rules.md'),
      vscode.Uri.joinPath(folder.uri, '.clawai', 'architecture.md'),
      vscode.Uri.joinPath(folder.uri, '.clawai', 'memory.md'),
    ];
    const globalContext = await this.globalContext?.readAll();
    const contents: string[] =
      globalContext === undefined || globalContext.length === 0 ? [] : [globalContext];
    for (const uri of ruleUris) {
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
  ): CollectedContext {
    return collectContext(candidates, {
      exclude: [...configuration.exclude, ...workspaceIgnore],
      maxBytes: configuration.maxContextBytes,
      maxFiles: configuration.maxContextFiles,
    });
  }

  private async readCandidates(uris: vscode.Uri[], maxBytes: number): Promise<ContextCandidate[]> {
    const candidates: ContextCandidate[] = [];
    for (const uri of uris) {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > maxBytes) {
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      candidates.push({
        path: this.scope.relativePath(uri),
        content,
      });
    }
    return candidates;
  }

  private async readIgnore(): Promise<string[]> {
    const folder = this.scope.selectedFolder();
    const content = await this.readOptionalText(
      vscode.Uri.joinPath(folder.uri, CLAWAI_IGNORE_PATH),
    );
    if (content === null) {
      return [];
    }
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
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
