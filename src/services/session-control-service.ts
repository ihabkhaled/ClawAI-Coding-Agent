import * as vscode from 'vscode';

import { applyAgentModeToPrompt } from '../core/agent-mode';
import { decidePermission } from '../core/permission-policy';

import type {
  SessionApprovalPort,
  SessionConfigurationPort,
  SessionStatePort,
} from './session-control.types';
import type { AgentMode } from '../core/agent-mode.types';
import type { PermissionMode, PermissionOperation } from '../core/permission-policy.types';

function approvalMessage(operation: PermissionOperation): string {
  if (operation === 'workspaceContext') {
    return vscode.l10n.t(
      'Allow ClawAI to read non-sensitive files from this workspace for this request?',
    );
  }
  if (operation === 'editGeneration') {
    return vscode.l10n.t(
      'Allow ClawAI to generate proposed edits for this request? You will review the final diff before anything changes.',
    );
  }
  if (operation === 'commandExecution') {
    return vscode.l10n.t('Allow ClawAI to run these safe development commands in this workspace?');
  }
  return vscode.l10n.t('Allow ClawAI to apply the reviewed file changes?');
}

function approvalTitle(operation: PermissionOperation): string {
  if (operation === 'workspaceContext') {
    return vscode.l10n.t('Workspace access');
  }
  if (operation === 'editGeneration') {
    return vscode.l10n.t('Generate proposed edits');
  }
  if (operation === 'commandExecution') {
    return vscode.l10n.t('Run development commands');
  }
  return vscode.l10n.t('Apply file changes');
}

export class SessionControlService {
  constructor(
    private readonly state: SessionStatePort,
    private readonly configuration: SessionConfigurationPort,
    private readonly approvals: SessionApprovalPort,
  ) {}

  async authorize(operation: PermissionOperation, details?: string[]): Promise<boolean> {
    const configuration = this.configuration.read();
    const decision = decidePermission({
      agentMode: configuration.agentMode,
      operation,
      permissionMode: configuration.permissionMode,
      sensitive: false,
      trusted: vscode.workspace.isTrusted,
    });
    if (decision.outcome === 'allow') {
      return true;
    }
    if (decision.outcome === 'deny') {
      return false;
    }
    return this.approvals.request({
      ...(details === undefined ? {} : { details }),
      kind: operation,
      message: approvalMessage(operation),
      title: approvalTitle(operation),
    });
  }

  isPlanMode(): boolean {
    return this.configuration.read().agentMode === 'PLAN';
  }

  preparePrompt(content: string): string {
    return applyAgentModeToPrompt(this.configuration.read().agentMode, content);
  }

  async selectAgentMode(mode: AgentMode): Promise<void> {
    await this.configuration.selectAgentMode(mode);
    this.state.update({ agentMode: mode });
  }

  async selectPermissionMode(mode: PermissionMode): Promise<boolean> {
    if (
      mode === 'BYPASS_PERMISSIONS' &&
      this.configuration.read().permissionMode !== 'BYPASS_PERMISSIONS' &&
      !(await this.approvals.request({
        kind: 'enableFullAccess',
        message: vscode.l10n.t(
          'Full Access applies safe workspace edits without repeated approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.',
        ),
        title: vscode.l10n.t('Enable Full Access'),
      }))
    ) {
      return false;
    }
    const selected = await this.configuration.selectPermissionMode(mode);
    if (selected) {
      this.state.update({ permissionMode: mode });
    }
    return selected;
  }
}
