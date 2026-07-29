import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

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
      const after = this.uri(generation, index, preview.path, 'after');
      this.content.set(before.toString(), preview.before ?? '');
      this.content.set(after.toString(), preview.after ?? '');
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

  dispose(): void {
    this.registration.dispose();
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
      this.content.delete(preview.after.toString());
    }
    this.batches.delete(oldestId);
  }

  private uri(generation: string, index: number, path: string, side: string): vscode.Uri {
    const safePath = path.replaceAll('\\', '/');
    return vscode.Uri.from({
      scheme: 'clawai-preview',
      path: `/${generation}/${side}/${String(index)}/${safePath}`,
    });
  }
}
