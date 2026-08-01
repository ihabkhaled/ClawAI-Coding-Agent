import * as vscode from 'vscode';

import { BackendRequestError, BackendSessionExpiredError } from './backend-errors';

export function sessionBoundaryMessage(error: Error): string {
  return error instanceof BackendSessionExpiredError
    ? vscode.l10n.t('Your ClawAI session expired. Reconnect to continue.')
    : error.message;
}

export function connectionOperationErrorMessage(error: unknown): string {
  if (error instanceof BackendSessionExpiredError) {
    return sessionBoundaryMessage(error);
  }
  if (error instanceof BackendRequestError && error.status === 0) {
    return vscode.l10n.t(
      'ClawAI backend is unavailable. Check the app address or start the services, then retry.',
    );
  }
  return error instanceof Error ? error.message : vscode.l10n.t('ClawAI operation failed.');
}

export function agentOperationErrorMessage(error: unknown): string {
  return error instanceof BackendSessionExpiredError
    ? sessionBoundaryMessage(error)
    : error instanceof Error
      ? error.message
      : vscode.l10n.t('ClawAI operation failed.');
}
