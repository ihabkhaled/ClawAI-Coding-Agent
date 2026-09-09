import * as vscode from 'vscode';

import type { UserNotificationPort } from './notify-user-tool-executor';
import type { UserNotificationInput } from '../core/user-notification';

/**
 * Delivers a notification through VS Code's own notification surface.
 *
 * Deliberately not awaited: `showInformationMessage` resolves when the toast
 * is dismissed, which for a notification with no buttons can be never. A run
 * that awaited it would hang on a toast the user simply ignored.
 */
export class VscodeUserNotifier implements UserNotificationPort {
  notify(input: UserNotificationInput): void {
    if (input.kind === 'warning') {
      void vscode.window.showWarningMessage(input.message);
      return;
    }
    void vscode.window.showInformationMessage(input.message);
  }
}
