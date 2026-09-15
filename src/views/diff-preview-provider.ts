import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { PREVIEW_DRAFT_SCHEME, PreviewDraftFileSystem } from './preview-draft-file-system';

import type { EditPreview } from '../services/safe-edit-service';

interface StagedPreview {
  after: vscode.Uri;
  before: vscode.Uri;
  path: string;
}

export class DiffPreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly batches = new Map<string, StagedPreview[]>();
  private readonly content = new Map<string, string>();
  private latestId: string | undefined;
  private readonly registration: vscode.Disposable;
  private readonly drafts = new PreviewDraftFileSystem();

  constructor() {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(
      'clawai-preview',
      this,
    );
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) ?? '';
  }

  stage(previews: EditPreview[]): string {
    const generation = randomUUID();
    const staged = previews.map((preview, index) => {
      const before = this.uri(generation, index, preview.path, 'before');
      const after = this.uri(generation, index, preview.path, 'after', PREVIEW_DRAFT_SCHEME);
      this.content.set(before.toString(), preview.before ?? '');
      // The after side is a writable draft, so a reviewer can correct the
      // proposal in the pane where they noticed it was wrong.
      this.drafts.set(after, preview.after ?? '');
      return {
        after,
        before,
        path: preview.path,
      };
    });
    this.batches.set(generation, staged);
    this.latestId = generation;
    this.trimOldestBatch();
    return generation;
  }

  async show(previewId = this.latestId): Promise<boolean> {
    const previews = previewId === undefined ? undefined : this.batches.get(previewId);
    if (previews === undefined) {
      return false;
    }
    for (const preview of previews) {
      await vscode.commands.executeCommand(
        'vscode.diff',
        preview.before,
        preview.after,
        vscode.l10n.t('ClawAI Preview: {0}', preview.path),
        {
          preview: true,
        },
      );
    }
    return true;
  }

  /**
   * What the reviewer left in the right-hand pane, keyed by path.
   *
   * Read from the open document first and the draft store second: a pane the
   * user typed in but never saved is exactly the case worth honouring, and
   * requiring a save before Apply would make the edit easy to lose.
   */
  edits(previewId = this.latestId): ReadonlyMap<string, string> {
    const previews = previewId === undefined ? undefined : this.batches.get(previewId);
    const edits = new Map<string, string>();
    for (const preview of previews ?? []) {
      const open = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === preview.after.toString(),
      );
      const text = open?.getText() ?? this.drafts.text(preview.after);
      if (text !== undefined) edits.set(preview.path, text);
    }
    return edits;
  }

  dispose(): void {
    this.registration.dispose();
    this.drafts.dispose();
    this.batches.clear();
    this.content.clear();
  }

  private trimOldestBatch(): void {
    if (this.batches.size <= 20) {
      return;
    }
    const oldestId = this.batches.keys().next().value;
    if (oldestId === undefined) {
      return;
    }
    const oldest = this.batches.get(oldestId) ?? [];
    for (const preview of oldest) {
      this.content.delete(preview.before.toString());
      this.drafts.forget(preview.after);
    }
    this.batches.delete(oldestId);
  }

  private uri(
    generation: string,
    index: number,
    path: string,
    side: string,
    scheme = 'clawai-preview',
  ): vscode.Uri {
    const safePath = path.replaceAll('\\', '/');
    return vscode.Uri.from({
      scheme,
      path: `/${generation}/${side}/${String(index)}/${safePath}`,
    });
  }
}
