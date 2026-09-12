import * as vscode from 'vscode';

import { agentAttentionQueue, attentionBadgeCount } from '../core/agent-attention';

import type { StateTreeProvider } from './state-tree-provider';
import type { ExtensionState } from '../core/extension-state';

/**
 * The attention list, plus the badge that makes it worth having.
 *
 * A view nobody opens cannot report a stalled run. The badge is the part that
 * reaches a reader who is looking at a source file, so it counts only what has
 * actually stopped — an approval, a question, a run that ended badly. Counting
 * queued work would leave it lit through every ordinary busy period, and a
 * badge that is always on says nothing at all.
 */
export class AttentionView implements vscode.Disposable {
  private readonly view: vscode.TreeView<vscode.TreeItem>;
  private readonly unsubscribe: () => void;

  constructor(viewId: string, provider: StateTreeProvider, state: ExtensionState) {
    this.view = vscode.window.createTreeView(viewId, { treeDataProvider: provider });
    this.unsubscribe = state.subscribe(() => {
      this.syncBadge(state);
    });
    this.syncBadge(state);
  }

  private syncBadge(state: ExtensionState): void {
    const count = attentionBadgeCount(agentAttentionQueue(state.snapshot, Date.now()));
    this.view.badge =
      count === 0
        ? undefined
        : { value: count, tooltip: vscode.l10n.t('{0} things are waiting for you', count) };
  }

  dispose(): void {
    this.unsubscribe();
    this.view.dispose();
  }
}
