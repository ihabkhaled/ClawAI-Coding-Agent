import * as vscode from 'vscode';

import type { ZeroRetentionPosture } from '../core/zero-retention.types';

/** Show Usage lines that state whether zero data retention is on, and who turned it on. */
export function zeroRetentionUsageLines(posture: ZeroRetentionPosture): string[] {
  const heading = `## ${vscode.l10n.t('Zero data retention')}`;
  if (!posture.active) return ['', heading, '', vscode.l10n.t('Off. Chats are stored as usual.')];
  const reason =
    posture.source === 'organization'
      ? vscode.l10n.t('On, required by your organization.')
      : vscode.l10n.t('On, turned on by your setting.');
  return [
    '',
    heading,
    '',
    reason,
    vscode.l10n.t(
      'Nothing is kept after a turn, and comparing models, uploads, publishing and sharing are refused.',
    ),
  ];
}
