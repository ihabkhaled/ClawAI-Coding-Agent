import * as vscode from 'vscode';

import { agentOperationErrorMessage } from '../backend/backend-error-message';

/**
 * Runs a command body and, if it throws, tells the person why in a
 * notification instead of letting the rejection reach VS Code's generic
 * "command failed" path. Signed-out is the common case: the backend refuses
 * with "Connect to ClawAI to continue.", which is a state, not a crash.
 */
export async function withFailureNotice(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error: unknown) {
    await vscode.window.showErrorMessage(agentOperationErrorMessage(error));
  }
}
