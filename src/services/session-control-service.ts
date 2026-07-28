import * as vscode from 'vscode';

import { applyAgentModeToPrompt } from '../core/agent-mode';
import { decidePermission } from '../core/permission-policy';

import type { SessionConfigurationPort, SessionStatePort } from './session-control.types';
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
  return vscode.l10n.t('Allow ClawAI to apply the reviewed file changes?');
}

export class SessionControlService {
  constructor(
    private readonly state: SessionStatePort,
    private readonly configuration: SessionConfigurationPort,
  ) {}

  async authorize(operation: PermissionOperation): Promise<boolean> {
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
    const allow = vscode.l10n.t('Allow once');
    const choice = await vscode.window.showWarningMessage(
      approvalMessage(operation),
      { modal: true },
      allow,
    );
    return choice === allow;
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
    const selected = await this.configuration.selectPermissionMode(mode);
    if (selected) {
      this.state.update({ permissionMode: mode });
    }
    return selected;
  }
}
