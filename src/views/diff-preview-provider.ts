import * as vscode from 'vscode';

import type { EditPreview } from '../services/safe-edit-service';

export class DiffPreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly content = new Map<string, string>();
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

  async show(previews: EditPreview[]): Promise<void> {
    for (const [index, preview] of previews.entries()) {
      const before = this.uri(index, preview.path, 'before');
      const after = this.uri(index, preview.path, 'after');
      this.content.set(before.toString(), preview.before ?? '');
      this.content.set(after.toString(), preview.after ?? '');
      await vscode.commands.executeCommand(
        'vscode.diff',
        before,
        after,
        vscode.l10n.t('ClawAI Preview: {0}', preview.path),
        {
          preview: true,
        },
      );
    }
  }

  dispose(): void {
    this.registration.dispose();
    this.content.clear();
  }

  private uri(index: number, path: string, side: string): vscode.Uri {
    const safePath = path.replaceAll('\\', '/');
    return vscode.Uri.from({
      scheme: 'clawai-preview',
      path: `/${side}/${String(index)}/${safePath}`,
    });
  }
}
