import * as vscode from 'vscode';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { SymbolQueryKind, WorkspaceLocation } from '../core/workspace-symbols';
import type { SymbolQuery, WorkspaceSymbolsPort } from '../services/workspace-intelligence-service';

const providerCommands: Readonly<Record<SymbolQueryKind, string>> = {
  definition: 'vscode.executeDefinitionProvider',
  references: 'vscode.executeReferenceProvider',
  implementations: 'vscode.executeImplementationProvider',
};

interface ProviderLocation {
  readonly uri?: vscode.Uri;
  readonly range?: vscode.Range;
  readonly targetUri?: vscode.Uri;
  readonly targetSelectionRange?: vscode.Range;
  readonly targetRange?: vscode.Range;
}

/**
 * `executeDefinitionProvider` returns `Location` from some providers and
 * `LocationLink` from others, and TypeScript is one of the latter. Reading only
 * `uri`/`range` therefore produced an empty answer for the language this
 * extension is mostly used on, which looks exactly like "no definition found".
 */
function positionOf(entry: ProviderLocation): { uri: vscode.Uri; range: vscode.Range } | undefined {
  const uri = entry.uri ?? entry.targetUri;
  const range = entry.range ?? entry.targetSelectionRange ?? entry.targetRange;
  return uri === undefined || range === undefined ? undefined : { uri, range };
}

export class VscodeWorkspaceSymbols implements WorkspaceSymbolsPort {
  constructor(private readonly adapter: VscodeFileTransactionAdapter) {}

  async locations(query: SymbolQuery): Promise<readonly WorkspaceLocation[]> {
    const uri = this.uriFor(query);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      throw new Error('The file could not be opened for a language query');
    }
    // Language servers answer nothing until they have loaded the document, and
    // an unopened file is the common case for an agent that found a path by
    // searching rather than by reading.
    const position = new vscode.Position(
      Math.max(0, query.line - 1),
      Math.max(0, query.column - 1),
    );
    const raw = await vscode.commands.executeCommand<readonly ProviderLocation[] | undefined>(
      providerCommands[query.kind],
      uri,
      position,
    );
    const collected: WorkspaceLocation[] = [];
    for (const entry of raw ?? []) {
      const resolved = positionOf(entry);
      if (resolved === undefined) continue;
      const preview = previewFor(document, resolved.uri, resolved.range);
      collected.push({
        path: vscode.workspace.asRelativePath(resolved.uri, false),
        line: resolved.range.start.line + 1,
        column: resolved.range.start.character + 1,
        ...(preview === undefined ? {} : { preview }),
      });
    }
    return collected;
  }

  private uriFor(query: SymbolQuery): vscode.Uri {
    return vscode.Uri.joinPath(this.adapter.rootUri(query.rootKey), ...query.path.split('/'));
  }

  async hover(query: SymbolQuery): Promise<string | undefined> {
    const uri = this.uriFor(query);
    try {
      await vscode.workspace.openTextDocument(uri);
    } catch {
      throw new Error('The file could not be opened for a language query');
    }
    const hovers = await vscode.commands.executeCommand<readonly vscode.Hover[] | undefined>(
      'vscode.executeHoverProvider',
      uri,
      new vscode.Position(Math.max(0, query.line - 1), Math.max(0, query.column - 1)),
    );
    // `contents` mixes plain strings, `MarkdownString`, and the deprecated
    // `MarkedString` object form. Only the first two are read; the third is a
    // shape no current provider produces and reading it means touching a
    // deprecated member for no gain.
    const text = (hovers ?? [])
      .flatMap((entry) => entry.contents)
      .map((content) => {
        if (typeof content === 'string') return content;
        return content instanceof vscode.MarkdownString ? content.value : '';
      })
      .filter((content) => content.length > 0)
      .join('\n')
      .trim();
    return text.length === 0 ? undefined : text;
  }
}

/**
 * Only the document already open for the query is read for a preview.
 *
 * Opening every target to quote a line would turn one navigation into an
 * unbounded read of files the caller never named, so a location in another file
 * arrives without a preview rather than with one bought that way.
 */
function previewFor(
  document: vscode.TextDocument,
  uri: vscode.Uri,
  range: vscode.Range,
): string | undefined {
  if (document.uri.toString() !== uri.toString()) return undefined;
  if (range.start.line >= document.lineCount) return undefined;
  return document.lineAt(range.start.line).text.trim().slice(0, 500);
}
