import * as vscode from 'vscode';

import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';

export type TreeKind = 'context' | 'history' | 'model';

function modelItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  const auto = new vscode.TreeItem(
    vscode.l10n.t('AUTO Router'),
    vscode.TreeItemCollapsibleState.None,
  );
  auto.description = snapshot.routingMode === 'AUTO' ? vscode.l10n.t('active') : '';
  auto.iconPath = new vscode.ThemeIcon('sparkle');
  auto.command = {
    command: 'clawAI.selectModel',
    title: vscode.l10n.t('Select AUTO Router'),
    arguments: ['AUTO'],
  };
  return [
    auto,
    ...snapshot.models.map((model) => {
      const item = new vscode.TreeItem(model.displayName, vscode.TreeItemCollapsibleState.None);
      item.description = [
        model.provider,
        model.isLocal ? vscode.l10n.t('local') : vscode.l10n.t('connected'),
        snapshot.selectedModel === model.key ? vscode.l10n.t('active') : '',
      ]
        .filter((part) => part.length > 0)
        .join(' · ');
      item.tooltip = [
        model.key,
        model.supportsStreaming ? vscode.l10n.t('Streaming') : '',
        model.supportsTools ? vscode.l10n.t('Tools') : '',
        model.supportsVision ? vscode.l10n.t('Vision') : '',
      ]
        .filter((part) => part.length > 0)
        .join(' · ');
      item.iconPath = new vscode.ThemeIcon(model.isLocal ? 'server-environment' : 'cloud');
      item.command = {
        command: 'clawAI.selectModel',
        title: vscode.l10n.t('Select model'),
        arguments: [model.key],
      };
      return item;
    }),
  ];
}

function contextItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  const receipt = snapshot.contextReceipt;
  if (receipt === undefined) {
    return [new vscode.TreeItem(vscode.l10n.t('No context collected yet'))];
  }
  const summary = new vscode.TreeItem(
    vscode.l10n.t('{0} files · {1} bytes', receipt.included.length, receipt.totalBytes),
  );
  summary.iconPath = new vscode.ThemeIcon('list-selection');
  return [
    summary,
    ...receipt.included.map((path) => {
      const item = new vscode.TreeItem(path);
      item.iconPath = new vscode.ThemeIcon('file-code');
      return item;
    }),
    ...receipt.excluded.slice(0, 20).map((entry) => {
      const item = new vscode.TreeItem(entry.path);
      item.description = entry.reason;
      item.iconPath = new vscode.ThemeIcon('exclude');
      return item;
    }),
  ];
}

function historyItems(snapshot: ExtensionSnapshot): vscode.TreeItem[] {
  if (snapshot.history.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('No recent conversations'))];
  }
  return snapshot.history.map((thread) => {
    const title = thread.title?.trim();
    const item = new vscode.TreeItem(
      title === undefined || title.length === 0 ? vscode.l10n.t('Untitled conversation') : title,
    );
    item.description = thread._count === undefined ? '' : String(thread._count.messages);
    item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.command = {
      command: 'clawAI.openChat',
      title: vscode.l10n.t('Open conversation'),
      arguments: [thread.id],
    };
    return item;
  });
}

export class StateTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  private readonly unsubscribe: () => void;
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly kind: TreeKind,
    private readonly state: ExtensionState,
  ) {
    this.unsubscribe = state.subscribe(() => {
      this.changeEmitter.fire(undefined);
    });
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.kind === 'model') {
      return modelItems(this.state.snapshot);
    }
    if (this.kind === 'context') {
      return contextItems(this.state.snapshot);
    }
    return historyItems(this.state.snapshot);
  }

  dispose(): void {
    this.unsubscribe();
    this.changeEmitter.dispose();
  }
}
