import * as vscode from 'vscode';

import { zeroRetentionRefusalMessage } from '../backend/zero-retention-messages';
import { zeroRetentionPosture } from '../core/zero-retention-posture';

import type { ZeroRetentionPostureStore } from '../core/zero-retention-posture';

/**
 * The parallel route stores every model's answer and the server does not
 * redact it, so under zero data retention a comparison is refused here, before
 * any request leaves this machine.
 */
export function refuseCompareUnderZeroRetention(
  posture: Pick<ZeroRetentionPostureStore, 'active'> = zeroRetentionPosture,
): void {
  if (posture.active()) throw new Error(zeroRetentionRefusalMessage('compare'));
}

/** The command-palette form: says why, and returns true when the command must stop. */
export async function refuseCompareCommand(
  posture: Pick<ZeroRetentionPostureStore, 'active'> = zeroRetentionPosture,
): Promise<boolean> {
  if (!posture.active()) return false;
  await vscode.window.showWarningMessage(zeroRetentionRefusalMessage('compare'));
  return true;
}
