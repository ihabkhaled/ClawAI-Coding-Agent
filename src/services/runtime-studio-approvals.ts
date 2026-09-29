import * as vscode from 'vscode';

import type { BrowserNavigationApprovalPort } from './browser-controller-service';
import type { DatabaseProfileMetadata } from './database-profile-vault';
import type { ApprovalBroker } from '../core/approval-broker';
import type { DatabaseStatementClass } from '../core/database-statement-policy';

/**
 * The approval dialogs the runtime studio's side-effecting services show.
 *
 * Kept together so every R2–R4 effect the studio can take reads the same way:
 * what it is for, what it touches, and what cannot be taken back.
 */

/** The reviewed-diff approval a Git commit needs before it is created. */
export function gitCommitApproval(
  approvals: ApprovalBroker,
): (diff: string, hash: string, signal?: AbortSignal) => Promise<boolean> {
  return (diff, hash, signal) =>
    approvals.request(
      {
        kind: 'runtimeEffect',
        title: vscode.l10n.t('Approve staged Git changes'),
        message: vscode.l10n.t('Review the exact staged diff before creating this commit.'),
        effect: {
          purpose: vscode.l10n.t('Create a reviewed Git commit'),
          target: hash,
          risk: 'R3',
          sideEffects: [vscode.l10n.t('The staged repository state will receive a new commit.')],
          reversibility: 'partially-reversible',
          sanitizedPreview: diff,
        },
      },
      signal,
    );
}

/** The approval a database write needs; production raises the risk to R4. */
export function databaseWriteApproval(
  approvals: ApprovalBroker,
): (
  profile: DatabaseProfileMetadata,
  classification: DatabaseStatementClass,
  statementHash: string,
  backupAcknowledged: boolean,
  signal?: AbortSignal,
) => Promise<boolean> {
  return (profile, classification, statementHash, backupAcknowledged, signal) =>
    approvals.request(
      {
        kind: 'runtimeEffect',
        title: vscode.l10n.t('Approve database change'),
        message: vscode.l10n.t('Review this database effect before execution.'),
        effect: {
          purpose: `${classification} database operation`,
          target: `${profile.label} · ${profile.environment}`,
          risk: profile.environment === 'production' ? 'R4' : 'R3',
          sideEffects: [backupAcknowledged ? 'Backup acknowledged' : 'No backup acknowledgement'],
          reversibility: 'partially-reversible',
          sanitizedPreview: statementHash,
        },
      },
      signal,
    );
}

/** The approval navigating to an origin outside the browser scope needs. */
export function browserOriginApproval(approvals: ApprovalBroker): BrowserNavigationApprovalPort {
  return {
    approveOrigin: (origin, signal) =>
      approvals.request(
        {
          kind: 'runtimeEffect',
          title: vscode.l10n.t('Approve browser navigation'),
          message: vscode.l10n.t('This origin is outside the current browser scope.'),
          effect: {
            purpose: vscode.l10n.t('Navigate the isolated browser'),
            target: origin,
            risk: 'R2',
            sideEffects: [vscode.l10n.t('The website may receive the browser request.')],
            reversibility: 'reversible',
          },
        },
        signal,
      ),
  };
}
