import * as vscode from 'vscode';

import { notificationReasonForStateChange } from '../core/user-notification';

import type { ExtensionSnapshot, ExtensionState } from '../core/extension-state';
import type { NotifiableState, NotificationReason } from '../core/user-notification';
import type { UserNotificationPort } from '../infrastructure/notify-user-tool-executor';

function notifiable(snapshot: ExtensionSnapshot): NotifiableState {
  return {
    approvalRequestId: snapshot.approvalRequest?.id,
    questionRequestId: snapshot.questionRequest?.id,
    busy: snapshot.busy,
    lastError: snapshot.lastError,
  };
}

function reasonMessage(reason: NotificationReason): string {
  switch (reason) {
    case 'approval':
      return vscode.l10n.t('ClawAI is waiting for your approval.');
    case 'question':
      return vscode.l10n.t('ClawAI is waiting for your answer.');
    case 'failure':
      return vscode.l10n.t('The ClawAI request failed.');
    default:
      return vscode.l10n.t('ClawAI finished the request.');
  }
}

/**
 * Brings the user back to a run that needs them.
 *
 * An observer of `ExtensionState` rather than a hook inside `ApprovalBroker`:
 * the broker already publishes every interruption it raises, so reading that
 * published state notifies on approvals, questions, failures and completions
 * through one path instead of four, and adds nothing to the queue the broker
 * has to withdraw when a run ends.
 *
 * Nothing fires while the window has focus, and there is no ClawAI setting to
 * silence it. VS Code's own notification controls — Do Not Disturb and the
 * per-source toggles — already own that decision for every extension, and a
 * second switch beside them would only be a way for the two to disagree.
 */
export class NotificationController implements vscode.Disposable {
  private previous: NotifiableState;
  private readonly unsubscribe: () => void;

  constructor(
    state: ExtensionState,
    private readonly notifications: UserNotificationPort,
    private readonly windowFocused: () => boolean = () => vscode.window.state.focused,
  ) {
    this.previous = notifiable(state.snapshot);
    this.unsubscribe = state.subscribe((snapshot) => {
      this.observe(snapshot);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private observe(snapshot: ExtensionSnapshot): void {
    const next = notifiable(snapshot);
    const reason = notificationReasonForStateChange(this.previous, next, this.windowFocused());
    this.previous = next;
    if (reason === undefined) return;
    this.notifications.notify({
      message: reasonMessage(reason),
      kind: reason === 'completion' ? 'info' : 'warning',
    });
  }
}
