import * as vscode from 'vscode';

import type { ZeroRetentionBlockedFeature } from '../core/zero-retention.types';

/** The translated reason a server-storing feature was refused under zero data retention. */
export function zeroRetentionRefusalMessage(feature: ZeroRetentionBlockedFeature): string {
  if (feature === 'upload') {
    return vscode.l10n.t(
      'Zero data retention is on, so files are not uploaded: an upload is stored on the server.',
    );
  }
  if (feature === 'artifact-publish') {
    return vscode.l10n.t(
      'Zero data retention is on, so nothing is published: a published page is stored on the server.',
    );
  }
  return vscode.l10n.t(
    'Zero data retention is on, so this chat cannot be shared: a share is stored on the server.',
  );
}
