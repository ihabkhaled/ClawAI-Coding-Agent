import * as vscode from 'vscode';

import { agentAttentionQueue } from '../core/agent-attention';

import type { AgentAttentionItem, AgentAttentionReason } from '../core/agent-attention.types';
import type { ExtensionSnapshot } from '../core/extension-state';

const REASON_ICONS: Readonly<Record<AgentAttentionReason, string>> = {
  approval: 'shield',
  question: 'question',
  failed: 'error',
  queued: 'watch',
  slow: 'clock',
};

function reasonLabel(reason: AgentAttentionReason): string {
  const labels: Record<AgentAttentionReason, string> = {
    approval: vscode.l10n.t('Waiting for approval'),
    question: vscode.l10n.t('Waiting for an answer'),
    failed: vscode.l10n.t('Finished badly'),
    queued: vscode.l10n.t('Waiting its turn'),
    slow: vscode.l10n.t('Still going'),
  };
  return labels[reason];
}

/**
 * The command that resolves each row.
 *
 * An attention list whose rows do not act on the thing they name is a second
 * place to read the same bad news. Approvals and questions live in the panel,
 * so both open it; a failed run opens it too, because that is where its
 * transcript is.
 */
const OPEN_CHAT = 'clawAI.openChat';

function attentionItem(entry: AgentAttentionItem): vscode.TreeItem {
  const item = new vscode.TreeItem(entry.title);
  item.description = reasonLabel(entry.reason);
  item.iconPath = new vscode.ThemeIcon(REASON_ICONS[entry.reason]);
  item.tooltip =
    entry.waitingMs === undefined
      ? entry.title
      : vscode.l10n.t(
          '{0} · {1} minutes so far',
          entry.title,
          Math.floor(entry.waitingMs / 60_000),
        );
  item.command = { command: OPEN_CHAT, title: vscode.l10n.t('Open chat') };
  return item;
}

/**
 * What is waiting for the reader, worst first.
 *
 * An unattended run stalls on an approval nobody clicked, and until now the
 * only place that said so was the panel — a reader looking at any other editor
 * got no signal at all.
 */
export function attentionItems(snapshot: ExtensionSnapshot, now: number): vscode.TreeItem[] {
  const queue = agentAttentionQueue(snapshot, now);
  if (queue.length === 0) {
    return [new vscode.TreeItem(vscode.l10n.t('Nothing is waiting for you'))];
  }
  return queue.map(attentionItem);
}
