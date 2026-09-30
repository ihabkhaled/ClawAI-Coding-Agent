import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { zeroRetentionPosture } from '../core/zero-retention-posture';

import { CrossWindowMailbox } from './cross-window-mailbox-store';

import type { WindowRefusal } from '../core/cross-window-mailbox.types';

/** Why cross-window mail must not run: retention is off-limits, or the workspace is untrusted. */
export function windowMailRefusal(): WindowRefusal | undefined {
  if (zeroRetentionPosture.active()) return 'zero-retention';
  if (!vscode.workspace.isTrusted) return 'untrusted';
  return undefined;
}

/**
 * This window's end of the per-user mailbox under global storage. The window id
 * and workspace name are stamped here by the host; an agent never supplies them.
 */
export function createVscodeCrossWindowMailbox(storage: vscode.Uri): CrossWindowMailbox {
  return new CrossWindowMailbox({
    rootDir: join(storage.fsPath, 'mailbox'),
    identity: {
      windowId: randomUUID(),
      workspaceName: vscode.workspace.name ?? 'untitled',
    },
    refusal: windowMailRefusal,
  });
}
