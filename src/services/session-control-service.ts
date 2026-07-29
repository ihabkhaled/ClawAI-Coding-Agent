import * as vscode from 'vscode';

import { applyAgentModeToPrompt } from '../core/agent-mode';
import { decidePermission } from '../core/permission-policy';

import type {
  SessionApprovalMemoryPort,
  SessionApprovalPort,
  SessionConfigurationPort,
  SessionControlPort,
  SessionPolicySnapshot,
  SessionStatePort,
} from './session-control.types';
import type { AgentMode } from '../core/agent-mode.types';
import type { PermissionMode, PermissionOperation } from '../core/permission-policy.types';

function approvalMessage(operation: PermissionOperation): string {
  if (operation === 'workspaceContext' || operation === 'editGeneration') {
    return vscode.l10n.t(
      'Allow ClawAI to read non-sensitive workspace files and generate proposed edits here without asking again? Final file changes and commands still require review.',
    );
  }
  if (operation === 'commandExecution') {
    return vscode.l10n.t('Allow ClawAI to run these safe development commands in this workspace?');
  }
  return vscode.l10n.t('Allow ClawAI to apply the reviewed file changes?');
}

function approvalTitle(operation: PermissionOperation): string {
  if (operation === 'workspaceContext' || operation === 'editGeneration') {
    return vscode.l10n.t('Enable routine workspace access');
  }
  if (operation === 'commandExecution') {
    return vscode.l10n.t('Run development commands');
  }
  return vscode.l10n.t('Apply file changes');
}

export class SessionControlService {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: SessionStatePort,
    private readonly configuration: SessionConfigurationPort,
    private readonly approvals: SessionApprovalPort,
    private readonly approvalMemory?: SessionApprovalMemoryPort,
  ) {}

  async authorize(operation: PermissionOperation, details?: string[]): Promise<boolean> {
    const configuration = this.configuration.read();
    return this.authorizeWithPolicy(
      {
        agentMode: configuration.agentMode,
        permissionMode: configuration.permissionMode,
        trusted: vscode.workspace.isTrusted,
      },
      operation,
      details,
    );
  }

  async capture(): Promise<SessionControlPort> {
    await this.mutationTail;
    const configuration = this.configuration.read();
    const policy: SessionPolicySnapshot = {
      agentMode: configuration.agentMode,
      permissionMode: configuration.permissionMode,
      trusted: vscode.workspace.isTrusted,
    };
    return {
      authorize: (operation, details) => this.authorizeWithPolicy(policy, operation, details),
      isPlanMode: () => policy.agentMode === 'PLAN',
      preparePrompt: (content) => applyAgentModeToPrompt(policy.agentMode, content),
    };
  }

  private async authorizeWithPolicy(
    policy: SessionPolicySnapshot,
    operation: PermissionOperation,
    details?: string[],
  ): Promise<boolean> {
    const decision = decidePermission({
      agentMode: policy.agentMode,
      operation,
      permissionMode: policy.permissionMode,
      sensitive: false,
      // Trust can only become more restrictive after submission, never more permissive.
      trusted: policy.trusted && vscode.workspace.isTrusted,
    });
    if (decision.outcome === 'allow') {
      return true;
    }
    if (decision.outcome === 'deny') {
      return false;
    }
    const routineOperation = operation === 'workspaceContext' || operation === 'editGeneration';
    if (routineOperation && this.approvalMemory?.hasRoutineAccess() === true) {
      return true;
    }
    const approved = await this.approvals.request({
      ...(details === undefined ? {} : { details }),
      kind: operation,
      message: approvalMessage(operation),
      title: approvalTitle(operation),
    });
    if (approved && routineOperation) {
      await this.approvalMemory?.rememberRoutineAccess();
    }
    return approved;
  }

  isPlanMode(): boolean {
    return this.configuration.read().agentMode === 'PLAN';
  }

  preparePrompt(content: string): string {
    return applyAgentModeToPrompt(this.configuration.read().agentMode, content);
  }

  selectAgentMode(mode: AgentMode): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.configuration.selectAgentMode(mode);
      this.state.update({ agentMode: mode });
    });
  }

  selectPermissionMode(mode: PermissionMode): Promise<boolean> {
    return this.enqueueMutation(async () => {
      if (
        mode === 'BYPASS_PERMISSIONS' &&
        this.configuration.read().permissionMode !== 'BYPASS_PERMISSIONS' &&
        !(await this.approvals.request({
          kind: 'enableFullAccess',
          message: vscode.l10n.t(
            'Full Access applies safe file changes automatically and skips routine workspace prompts. Development commands still require approval. Workspace Trust, secret exclusions, path boundaries, and blocked-command rules remain enforced.',
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
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
