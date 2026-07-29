import * as vscode from 'vscode';

import type { RequestAdmission } from './agent-coordinator.types';
import type { SessionControlService } from './session-control-service';
import type { WorkspaceContextService } from './workspace-context-service';
import type { AccountEpoch } from '../core/account-epoch';

export class RequestAdmissionService {
  constructor(
    private readonly boundary: AccountEpoch,
    private readonly context: WorkspaceContextService,
    private readonly sessions: SessionControlService,
  ) {}

  capture(threadId?: string): RequestAdmission {
    this.context.freezeWorkspaceFolder();
    return Object.freeze({
      boundaryEpoch: this.boundary.capture(),
      boundarySignal: this.boundary.captureSignal(),
      session: this.sessions.capture(),
      threadId,
      workspaceFolderKey: this.context.scopeSnapshot().selectedFolderKey,
    });
  }

  assert(admission: RequestAdmission): void {
    if (
      !this.boundary.isCurrent(admission.boundaryEpoch) ||
      this.context.scopeSnapshot().selectedFolderKey !== admission.workspaceFolderKey
    ) {
      throw new Error(
        vscode.l10n.t('ClawAI request was cancelled because the account or workspace changed.'),
      );
    }
  }
}
