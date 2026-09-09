import * as vscode from 'vscode';

import { statusLineActivity, statusLineModel, statusLineQueueDepth } from '../core/status-line';

import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';
import type { StatusLineActivity } from '../core/status-line.types';

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

const ACTIVITY_ICONS: Readonly<Record<StatusLineActivity, string>> = {
  'awaiting-you': '$(question)',
  connecting: '$(sync~spin)',
  disconnected: '$(plug)',
  idle: '$(sparkle)',
  queued: '$(clock)',
  running: '$(loading~spin)',
};

function activityLabel(activity: StatusLineActivity, queued: number): string {
  if (activity === 'disconnected') return vscode.l10n.t('Connect');
  if (activity === 'connecting') return vscode.l10n.t('Connecting');
  if (activity === 'awaiting-you') return vscode.l10n.t('Waiting for you');
  if (activity === 'running') {
    // "Running" and "running with four queued" are different situations for
    // the person deciding whether to send a fifth.
    return queued === 0
      ? vscode.l10n.t('Running')
      : vscode.l10n.t('Running, {0} queued', String(queued));
  }
  if (activity === 'queued') return vscode.l10n.t('{0} queued', String(queued));
  return '';
}

export function statusBarText(snapshot: ExtensionSnapshot): string {
  const activity = statusLineActivity(snapshot);
  const queued = statusLineQueueDepth(snapshot);
  const label = activityLabel(activity, queued);
  if (activity === 'disconnected' || activity === 'connecting') {
    return `${ACTIVITY_ICONS[activity]} ClawAI · ${label}`;
  }
  const model = statusLineModel(snapshot);
  const name = model.automatic ? vscode.l10n.t('Auto') : model.name;
  const parts = label.length === 0 ? [name] : [name, label];
  return `${ACTIVITY_ICONS[activity]} ClawAI · ${parts.join(' · ')}`;
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
    this.item.text = statusBarText(snapshot);
    this.item.tooltip = [
      `Backend: ${snapshot.backendUrl}`,
      `Status: ${snapshot.backendStatus}`,
      usageLabel(snapshot),
    ]
      .filter((part) => part.length > 0)
      .join('\n');
    // A question nobody has answered stops the run entirely, so it earns the
    // one colour the status bar has for "look here".
    const warn =
      snapshot.backendStatus === 'error' || statusLineActivity(snapshot) === 'awaiting-you';
    this.item.backgroundColor = warn
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }
}
