import * as vscode from 'vscode';

import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';

function usageLabel(snapshot: ExtensionSnapshot): string {
  const day = snapshot.usage?.day;
  if (day === undefined) {
    return '';
  }
  if (day.limit === null) {
    return vscode.l10n.t('{0} tokens', day.used);
  }
  return vscode.l10n.t('{0}/{1} tokens', day.used, day.limit);
}

export class StatusBarController implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  private readonly unsubscribe: () => void;

  constructor(state: ExtensionState) {
    this.item.name = 'ClawAI';
    this.item.command = 'clawAI.openChat';
    this.unsubscribe = state.subscribe((snapshot) => {
      this.render(snapshot);
    });
    this.item.show();
  }

  dispose(): void {
    this.unsubscribe();
    this.item.dispose();
  }

  private render(snapshot: ExtensionSnapshot): void {
    const model =
      snapshot.routingMode === 'AUTO'
        ? 'AUTO'
        : (snapshot.models.find((entry) => entry.key === snapshot.selectedModel)?.displayName ??
          snapshot.selectedModel);
    const icon =
      snapshot.backendStatus === 'connected'
        ? '$(sparkle)'
        : snapshot.backendStatus === 'loading'
          ? '$(sync~spin)'
          : '$(warning)';
    this.item.text = `${icon} ClawAI · ${model || 'AUTO'}`;
    this.item.tooltip = [
      `Backend: ${snapshot.backendUrl}`,
      `Status: ${snapshot.backendStatus}`,
      usageLabel(snapshot),
    ]
      .filter((part) => part.length > 0)
      .join('\n');
    this.item.backgroundColor =
      snapshot.backendStatus === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;
  }
}
